const _ = require('lodash');
const ldap = require('ldapjs-promise');

class Lderp {
    #client = null;

    constructor(host, options, logger) {
        options = options || { };
        this.name = 'lderp';
        this.clientOptions = options.client || { };
        this.host = host;
        this.baseDn = options.baseDn || '';
        this.defaultAttributes = options.defaultAttributes || [ ];
        this.usernameAttribute = options.usernameAttribute || 'cn';
        this.logger = logger || null;
        this.timeout = options.timeout || (1000 * 60 * 10); // ten minutes
    }

    get client() {
        const defaults = {
            url: this.host,
            timeout: this.timeout,
            log: this.logger,
        };
        let options = { };
        Object.assign(options, this.clientOptions);
        _.defaults(options, defaults);
        if (!this.#client) this.#client = ldap.createClient(options);
        return this.#client;
    }

    bindAsUser = async (dn, password) => {
        return this.client.bind(dn, password);
    };

    buildDn = (username) => {
        throw new Error('Lderp#buildDn must be overridden by subclass');
    };

    buildLdapChangeObject = (operation, modification) => {
        return new ldap.Change({
            operation: operation,
            modification: modification,
        });
    };

    buildUserEntry = (options) => {
        throw new Error('Lderp#buildUserEntry must be overridden by subclass');
    };

    #buildUserFilter = (username) => {
        return `(${ this.usernameAttribute }=${ username })`;
    };

    #buildFilterFromWhere = (where) => {
        const filters = _.map(where, function (value, key) {
            return `(${ key }=${ value })`;
        });
        if (filters.length > 1) return `(&${ filters.join('') })`;
        return filters.join('');
    };

    createUser = async (dn, options) => {
        return this.client.add(dn, this.buildUserEntry(options));
    };

    deleteUser = async (dn) => {
        return this.client.del(dn);
    };

    destroy = async () => {
        return this.client.destroy();
    };

    find = async (where) => {
        const filter = (_.isEmpty(where) ? this.#buildUserFilter('*') : (!where.filter ? this.#buildFilterFromWhere(where) : where.filter));
        return this.search(filter);
    };

    findUser = async (username) => {
        const entries = await this.search(this.#buildUserFilter(username));
        if (!entries || !Array.isArray(entries) || (entries.length === 0)) return null;
        return entries[ 0 ];
    };

    getClient = (options) => {
        const defaults = {
            url: this.host,
            timeout: this.timeout,
            log: this.logger,
        };
        _.defaults(options, defaults);
        if (!this.#client) this.#client = ldap.createClient(options);
        return this.#client;
    };

    getPersonalNameByUsername = async (username) => {
        const user = await this.findUser(username);
        return this.#getPersonalNameByEntry(user);
    };

    #getPersonalNameByEntry = (entry) => {
        return (entry ? { first: entry.givenName, last: entry.sn } : null);
    };

    search = async (filter, options) => {
        options = options || { };
        const searchOptions = {
            attributes: options.attributes || this.defaultAttributes,
            filter,
            scope: options.score || 'sub',
            timeLimit: options.timeLimit || (this.timeout / 1000), // timeout is in milliseconds, timeLimit in seconds
        };
        return this.client.searchReturnAll(this.baseDn, searchOptions);
    };

    unbind = async () => {
        return this.client.unbind();
    };

}

class LderpAd extends Lderp {
    #zombie;

    constructor(host, options, logger) {
        options = options || { };
        super(host, options, logger);
        this.name = 'lderp-ad';
        this.usernameAttribute = options.usernameAttribute || 'sAMAccountName';
        this.#zombie = {
            username: options.zombieUsername || '',
            password: options.zombiePassword || '',
        };
    }

    bindAsZombie = async (zombieUsername, zombiePassword) => {
        return this.bindAsUser(this.buildDn((zombieUsername || this.#zombie.username)), zombiePassword || this.#zombie.password);
    };

    buildDn = (samAccountName) => {
        return `AD\\${ samAccountName }`;
    };

}

class LderpEdir extends Lderp {
    #zombie;

    constructor(host, options, logger) {
        options = options || { };
        super(host, options, logger);
        this.name = 'lderp-edir';
        this.#zombie = {
            dn: options.zombieDn || this.baseDn,
            username: options.zombieUsername || '',
            password: options.zombiePassword || '',
        };
    }

    bindAsZombie = async (zombieUsername, zombiePassword, zombieDn) => {
        return this.bindAsUser(this.buildDn((zombieUsername || this.#zombie.username), (zombieDn || this.#zombie.dn)), zombiePassword || this.#zombie.password);
    };

    buildDn = (cn, baseDn = this.baseDn) => {
        return `cn=${ cn },${ baseDn }`;
    };

    #buildObjectClass = () => {
        return [
            'inetOrgPerson',
            'organizationalPerson',
            'Person',
            'ndsLoginProperties',
            'Top'
        ];
    };

    buildUserEntry = (options) => {
        let entry = _.clone(options);
        entry.objectClass = this.#buildObjectClass();
        entry.uid = entry.cn;
        return entry;
    };

    createUser = async (options) => {
        return this.createUser(this.buildDn(options.cn), options);
    };

    deleteUser = async (cn) => {
        return this.deleteUser(this.buildDn(cn));
    };

    findAllEmailAddressless = async (startsWith) => {
        return this.search(`(&(cn=${ startsWith }*)(!(cn=*@*)))`);
    };

    modifyUser = async (cn, options) => {
        options = options || { };
        const newCn = options.cn || options.username || null;
        options.uid = options.uid || newCn || null; // keeping UID and CN in sync
        options.givenName = options.givenName || options.firstname || options.firstName || options.first || null;
        options.mail = options.mail || options.email || null;
        options.sn = options.sn || options.lastname || options.lastName || options.last || null;
        options.userPassword = options.userPassword || options.password || null;
        options = _.omitBy(_.omit(options, [ 'cn', 'username', 'firstname', 'email', 'lastname', 'password' ]), _.isNull);
        const user = await this.findUser(cn);
        if (!user) throw new Error('User could not be located');
        const changes = _.map(options, function (value, key) {
            return this.buildLdapChangeObject('replace', { [ key ]: value });
        });
        const result = await this.client.modify(user.dn, changes);
        if (!newCn) return result;
        const newDn = this.buildDn(newCn);
        await this.client.modifyDN(self.user.dn, newDn);
        return result;
    };

}

module.exports = {
    Lderp,
    LderpAd,
    LderpEdir,
};
