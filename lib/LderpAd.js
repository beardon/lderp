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

module.exports = LderpAd;
