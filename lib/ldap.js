'use strict';

var _ = require('lodash');
var ldapjs = require('ldapjs');
var moment = require('moment');
var Promise = require('bluebird');

function Ldap(host, options) {
    options = options || {};
    this.name = 'ldap';
    this.baseDn = options.baseDn || '';
    this.defaultAttributes = options.defaultAttributes || [];
    this.usernameAttribute = options.usernameAttribute || 'cn';
    this._client = Promise.promisifyAll(ldapjs.createClient({ url: host }))
}

Ldap.prototype.bindAsUser = function (dn, password) {
    var clientErrorPromise = new Promise(function (resolve, reject) {
        this._client.once('error', function (err) {
            this._client.destroyAsync();
            reject(err);
        }.bind(this));
    }.bind(this));
    var bindPromise = this._client.bindAsync(dn, password).return(this);
    return Promise.race([clientErrorPromise, bindPromise]);
};

Ldap.prototype.bindAsZombie = function () {
    throw new Error('Ldap#bindAsZombie must be overridden by subclass');
};

Ldap.prototype.buildDn = function (username) {
    throw new Error('Ldap#buildDn must be overridden by subclass');
};

Ldap.prototype.buildLdapChangeObject = function (operation, modification) {
    return new ldapjs.Change({
        operation: operation,
        modification: modification
    });
};

Ldap.prototype.buildUserEntry = function (options) {
    throw new Error('Ldap#buildUserEntry must be overridden by subclass');
};

Ldap.prototype._buildUserFilter = function (username) {
    return '(' + this.usernameAttribute + '=' + username + ')';
};

Ldap.prototype._buildFilterFromWhere = function (where) {
    var filters = _.map(where, function (value, key) {
        return '(' + key + '=' + value + ')';
    });
    if (filters.length > 1) {
        return '(&' + filters.join('') + ')';
    }
    return filters.join('');
};

Ldap.prototype._checkBindStatus = function () {
    var self = this;
    return this.bindAsZombie()
        .reflect()
        .call('isFulfilled');
};

Ldap.prototype.checkStatus = function () {
    var start = moment();
    return this._checkBindStatus()
        .then(function (bindStatus) {
            var status = {};
            status.online = bindStatus;
            status.subsystems = {
                bind: bindStatus
            };
            status.latency = moment().diff(start, 'milliseconds', true) + 'ms';
            return status;
        });
};

Ldap.prototype.createUser = function (dn, options) {
    return this._client.addAsync(dn, this.buildUserEntry(options));
};

Ldap.prototype.deleteUser = function (dn) {
    return this._client.delAsync(dn);
};

Ldap.prototype.destroy = function () {
    return this._client.destroyAsync()
        .reflect()
        .call('isFulfilled');
};

Ldap.prototype.find = function (where) {
    var filter = (_.isEmpty(where) ? this._buildUserFilter('*') : (!where.filter ? this._buildFilterFromWhere(where) : where.filter));
    return this._search(filter);
};

Ldap.prototype.findUser = function (username) {
    return this._search(this._buildUserFilter(username))
        .then(function (searchResults) {
            var searchResult = null;
            if (searchResults.length > 0) {
                searchResult = searchResults[0];
            }
            return searchResult;
        });
};

Ldap.getPersonalNameByUsername = function (username) {
    var self = this;
    return self.findUser(username)
        .then(function (entry) {
            return self._getPersonalNameByEntry(entry);
        });
};

Ldap.prototype._getPersonalNameByEntry = function (entry) {
    return (!!entry ? { first: entry.givenName, last: entry.sn } : null);
};

Ldap.prototype._search = function (filter, options) {
    options = options || {};
    var opts = {
        attributes: options.attributes || this.defaultAttributes,
        filter: filter,
        scope: options.score || 'sub',
        timeLimit: options.timeLimit || 600
    };
    return this._client.searchAsync(this.baseDn, opts)
        .then(function (searchResult) {
            return new Promise(function (resolve, reject) {
                var ldapEntries = [];

                searchResult.on('searchEntry', function (entry) {
                    ldapEntries.push(entry.object);
                });
                searchResult.on('error', function (err) {
                    return reject(err);
                });
                searchResult.on('end', function (endResult) {
                    if ((ldapEntries) && (endResult.status == 0)) {
                        return resolve(ldapEntries);
                    }
                    return resolve(null);
                });
            });
        });
};

Ldap.prototype.unbind = function () {
    return this._client.unbindAsync()
        .reflect()
        .call('isFulfilled');
};

module.exports = Ldap;
