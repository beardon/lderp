// Copyright (c) 2014-2026 by Beardon Services, Inc.

const _ = require('lodash');
const Lderp = require('./Lderp');

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

    _fixDate(value) {
        if (!_.isString(value)) return value;
        const ticks = +(value.substring(0, value.length - 4));
        if (!_.isInteger(ticks)) return value;
        const epoch = Date.UTC(1601, 0, 1);
        return new Date(epoch + ticks);
    }

    _fixValue(type, value) {
        value = super._fixValue(type, value);
        switch (type) {
            case 'lastLogon': return this._fixDate(value);
            case 'whenCreated': return this._fixDate(value);
        }
        return value;
    }

}

module.exports = LderpAd;
