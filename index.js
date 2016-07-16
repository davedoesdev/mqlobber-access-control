/*
# mqlobber-access-control&nbsp;&nbsp;&nbsp;[![Build Status](https://travis-ci.org/davedoesdev/mqlobber-access-control.png)](https://travis-ci.org/davedoesdev/mqlobber-access-control) [![Coverage Status](https://coveralls.io/repos/davedoesdev/mqlobber-access-control/badge.png?branch=master&service=github)](https://coveralls.io/r/davedoesdev/mqlobber-access-control?branch=master) [![NPM version](https://badge.fury.io/js/mqlobber-access-control.png)](http://badge.fury.io/js/mqlobber-access-control)

Access control for [mqlobber](https://github.com/davedoesdev/mqlobber) message
queues. Specify to which topics clients can (and can't) subscribe and publish.

The API is described [here](#api).

## Example:

Here's a server program which listens on a TCP port specified on the command
line. It allows clients to:

- Publish messages to topics matching `foo.#` (i.e. any topic beginning with `foo.`)
- Subscribe to messages with topics matching `foo.#`



```javascript


```


*/
"use strict";

var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    QlobberDedup = require('qlobber').QlobberDedup;

function AccessControl(options)
{
    EventEmitter.call(this);

    var ths = this;

    function allow(type, topic)
    {
        if (ths._matchers[type].disallow &&
            ths._matchers[type].disallow.match(topic).size > 0)
        {
            return false;
        }

        if (ths._matchers[type].allow &&
            ths._matchers[type].allow.match(topic).size === 0)
        {
            return false;
        }

        return true;
    }

    this._subscribe_requested = function (topic, done)
    {
        if (allow('subscribe', topic))
        {
            return this.subscribe(topic, done);
        }

        done(new Error('blocked subscribe to topic: ' + topic));
        ths.emit('subscribe_blocked', topic);
    };

    this._publish_requested = function (topic, duplex, options, done)
    {
        if (allow('publish', topic))
        {
            return duplex.pipe(this.fsq.publish(topic, options, done));
        }

        done(new Error('blocked publish to topic: ' + topic));
        ths.emit('publish_blocked', topic);
    };

    this.reset(options);
}

util.inherits(AccessControl, EventEmitter);

AccessControl.prototype.reset = function (options)
{
    var ths = this, topic;

    options = options || {};

    this._matchers = {
        publish: {},
        subscribe: {}
    };

    function make(type, access)
    {
        if (options[type] && options[type][access])
        {
            ths._matchers[type][access] = new QlobberDedup();
            for (topic of options[type][access])
            {
                ths._matchers[type][access].add(topic, true);
            }
        }
    }

    function setup(type)
    {
        make(type, 'allow');
        make(type, 'disallow');
    }

    setup('publish');
    setup('subscribe');
};

AccessControl.prototype.attach = function (server)
{
    server.on('subscribe_requested', this._subscribe_requested);
    server.on('publish_requested', this._publish_requested);
};

AccessControl.prototype.detach = function (server)
{
    server.removeListener('subscribe_requested', this._subscribe_requested);
    server.removeListener('publish_requested', this._publish_requested);
};

exports.AccessControl = AccessControl;
