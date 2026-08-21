const _ = require('lodash');
const ldap = require('ldapjs-promise');

function buildFilter(key, value) {
    return `(${ key }=${ value })`;
}

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
            return buildFilter(key, value);
        });
        if (filters.length > 1) return `(&${ filters.join('') })`;
        return filters.join('');
    }

    buildLdapChangeObject(operation, modification) {
        return new ldap.Change({ operation, modification });
    }

    buildLdapModificationObject(type, values) {
        return { type, values: _.isArray(values) ? values : [ values ] }
    }

    #buildMailFilter(mail) {
        return buildFilter('mail', mail);
    }

    buildUserEntry(values) {
        throw new Error('Lderp#buildUserEntry must be overridden by subclass');
    }

    #buildUserFilter(username) {
        return buildFilter(this.usernameAttribute, this._escapeCn(username));
    }

    async createUser(dn, values) {
        if (!_.isString(dn)) throw new Error('DN must be a string');
        if (!_.isObject(values)) throw new Error('Values must be an object');
        return this.client.add(dn, this.buildUserEntry(values));
    }

    async deleteUser(dn) {
        return this.client.del(dn);
    }

    async destroy() {
        return this.client.destroy();
    }

    _escapeCn(cn) {
        if (!_.isString(cn)) return null;
        return cn.replaceAll('+', '\\+');
    }

    async find(where) {
        const filter = (_.isEmpty(where) ? this.#buildUserFilter('*') : (!where.filter ? this.#buildFilterFromWhere(where) : where.filter));
        return this.search(filter);
    }

    async findMail(mail) {
        const entries = await this.search(this.#buildMailFilter(mail));
        if (!entries || !_.isArray(entries) || (entries.length === 0)) return null;
        return entries[ 0 ];
    }

    async findUser(username) {
        const entries = await this.search(this.#buildUserFilter(username));
        if (!entries || !_.isArray(entries) || (entries.length === 0)) return null;
        return entries[ 0 ];
    }

    fixValue(type, value) {
        if (_.isString(value)) {
            switch (value.toUpperCase()) {
                case 'FALSE': return false;
                case 'TRUE': return true;
            }
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

module.exports = Lderp;
