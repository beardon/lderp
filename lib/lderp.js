const _ = require('lodash');
const { DateTime } = require('luxon');
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

    async bindAsUser(dn, password) {
        return this.client.bind(dn, password);
    }

    buildDn(username) {
        throw new Error('Lderp#buildDn must be overridden by subclass');
    }

    #buildFilterFromWhere(where) {
        const filters = _.map(where, function (value, key) {
            return `(${ key }=${ value })`;
        });
        if (filters.length > 1) return `(&${ filters.join('') })`;
        return filters.join('');
    }

    buildLdapChangeObject(operation, modification) {
        return new ldap.Change({ operation, modification });
    }

    buildLdapModificationObject(type, values) {
        return { type, values: Array.isArray(values) ? values : [ values ]}
    }

    buildUserEntry(options) {
        throw new Error('Lderp#buildUserEntry must be overridden by subclass');
    }

    #buildUserFilter(username) {
        return `(${ this.usernameAttribute }=${ username })`;
    }

    async createUser(dn, values) {
        return this.client.add(dn, this.buildUserEntry(values));
    }

    async deleteUser(dn) {
        return this.client.del(dn);
    }

    async destroy() {
        return this.client.destroy();
    }

    async find(where) {
        const filter = (_.isEmpty(where) ? this.#buildUserFilter('*') : (!where.filter ? this.#buildFilterFromWhere(where) : where.filter));
        return this.search(filter);
    }

    async findUser(username) {
        const entries = await this.search(this.#buildUserFilter(username));
        if (!entries || !Array.isArray(entries) || (entries.length === 0)) return null;
        return entries[ 0 ];
    }

    fixValue(type, value) {
        switch (value.toUpperCase()) {
            case 'FALSE': return false;
            case 'TRUE': return true;
        }
        return value;
    }

    #formatEntryPojo(pojo) {
        let formattedAttributes = {
            dn: pojo.objectName,
        };
        for (const attribute of pojo.attributes) {
            const type = attribute.type;
            const values = _.map(attribute.values, (value) => this.fixValue(type, value));
            formattedAttributes[ type ] = (values.length > 1) ? values : values[ 0 ];
        }
        return formattedAttributes;
    }

    async getPersonalNameByUsername(username) {
        const user = await this.findUser(username);
        return this.#getPersonalNameByEntry(user);
    }

    #getPersonalNameByEntry(entry) {
        return (entry ? { first: entry.givenName, last: entry.sn } : null);
    }

    async search(filter, options) {
        options = options || { };
        const searchOptions = {
            attributes: options.attributes || this.defaultAttributes,
            filter,
            scope: options.scope || 'sub',
            timeLimit: options.timeLimit || 600,//(this.timeout / 1000), // timeout is in milliseconds, timeLimit in seconds
        };
        const results = await this.client.searchReturnAll(this.baseDn, searchOptions);
        return _.map(results.entries, (entry) => {
            return this.#formatEntryPojo(entry.pojo);
        });
    }

    async unbind() {
        return this.client.unbind();
    }

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

    async bindAsZombie(zombieUsername, zombiePassword) {
        return this.bindAsUser(this.buildDn((zombieUsername || this.#zombie.username)), zombiePassword || this.#zombie.password);
    }

    buildDn(samAccountName) {
        return `AD\\${ samAccountName }`;
    }

    filetimeToJsDate(filetime) {
        const ticks = +filetime.substring(0, filetime.length - 4);
        const epoch = Date.UTC(1601, 0, 1);
        return new Date(epoch + ticks);
    }

    fixValue(type, value) {
        value = super.fixValue(type, value);
        switch (type) {
            case 'lastLogon': return this.filetimeToJsDate(value);
            default: return value;
        }
    }

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

    async bindAsZombie(zombieUsername, zombiePassword, zombieDn) {
        return this.bindAsUser(this.buildDn((zombieUsername || this.#zombie.username), (zombieDn || this.#zombie.dn)), zombiePassword || this.#zombie.password);
    }

    buildDn(cn, baseDn = this.baseDn) {
        return `cn=${ cn },${ baseDn }`;
    }

    #buildObjectClass() {
        return [
            'inetOrgPerson',
            'organizationalPerson',
            'Person',
            'ndsLoginProperties',
            'Top'
        ];
    }

    buildUserEntry(options) {
        let entry = _.clone(options);
        entry.objectClass = this.#buildObjectClass();
        entry.uid = entry.cn;
        return entry;
    }

    async createUser(values) {
        return super.createUser(this.buildDn(values.cn), values);
    }

    async deleteUser(cn) {
        return super.deleteUser(this.buildDn(cn));
    }

    async findAllEmailAddressless(startsWith) {
        return this.search(`(&(cn=${ startsWith }*)(!(cn=*@*)))`);
    }

    fixValue(type, value) {
        value = super.fixValue(type, value);
        switch (type) {
            case 'loginTime': return DateTime.fromFormat(value.substring(0, value.indexOf('Z')), 'yyyyLLddHHmmss').toJSDate();
            default: return value;
        }
    }

    async modifyUser(cn, values) {
        values = values || { };
        const newCn = values.cn || values.username || null;
        values.uid = values.uid || newCn || null; // keeping UID and CN in sync
        values.givenName = values.givenName || values.firstname || values.firstName || values.first || null;
        values.mail = values.mail || values.email || null;
        values.sn = values.sn || values.lastname || values.lastName || values.last || null;
        values.userPassword = values.userPassword || values.password || null;
        values = _.omitBy(_.omit(values, [ 'cn', 'username', 'firstname', 'email', 'lastname', 'password' ]), _.isNull);
        const user = await this.findUser(cn);
        if (!user) throw new Error('User could not be located');
        const buildLdapChangeObject = this.buildLdapChangeObject;
        const buildLdapModificationObject = this.buildLdapModificationObject;
        const changes = _.map(values, function (value, key) {
            const modification = buildLdapModificationObject(key, value);
            return buildLdapChangeObject('replace', modification);
        });
        const result = await this.client.modify(user.dn, changes);
        if (!newCn) return result;
        const newDn = this.buildDn(newCn);
        await this.client.modifyDN(user.dn, newDn);
        return result;
    }

}

module.exports = {
    Lderp,
    LderpAd,
    LderpEdir,
};
