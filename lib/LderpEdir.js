const _ = require('lodash');
const { DateTime } = require('luxon');

const Lderp = require('./Lderp');

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
        return `cn=${ this._escapeCn(cn) },${ baseDn }`;
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

    buildUserEntry(values) {
        if (!_.isObject(values)) throw new Error('Options must be an object');
        if (!_.isString(values.cn)) throw new Error('CN must be a string');
        const entry = _.clone(values);
        entry.cn = this._escapeCn(entry.cn);
        entry.objectClass = this.#buildObjectClass();
        entry.uid = entry.cn;
        return entry;
    }

    async createUser(values) {
        if (!_.isObject(values)) throw new Error('Values must be an object');
        if (!_.isString(values.cn)) throw new Error('CN must be a string');
        return super.createUser(this.buildDn(values.cn), values);
    }

    async deleteUser(cn) {
        return super.deleteUser(this.buildDn(cn));
    }

    async findAllEmailAddressless(startsWith) {
        return this.search(`(&(cn=${ this._escapeCn(startsWith) }*)(!(cn=*@*)))`);
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

module.exports = LderpEdir;
