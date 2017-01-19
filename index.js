/*
# mqlobber-access-control&nbsp;&nbsp;&nbsp;[![Build Status](https://travis-ci.org/davedoesdev/mqlobber-access-control.png)](https://travis-ci.org/davedoesdev/mqlobber-access-control) [![Coverage Status](https://coveralls.io/repos/davedoesdev/mqlobber-access-control/badge.png?branch=master&service=github)](https://coveralls.io/r/davedoesdev/mqlobber-access-control?branch=master) [![NPM version](https://badge.fury.io/js/mqlobber-access-control.png)](http://badge.fury.io/js/mqlobber-access-control)

Access control for [mqlobber](https://github.com/davedoesdev/mqlobber) message
queues. Specify to which topics clients can (and can't) subscribe, publish and
receive.

The API is described [here](#api).

## Example:

Here's a server program which listens on a TCP port specified on the command
line. It allows clients to:

- Publish messages to topics matching `foo.bar.#` (i.e. any topic beginning with `foo.bar.`) but _not_ to `foo.bar.reserved`
- Subscribe to messages with topics matching `foo.#` (i.e. any topic beginning with `foo.`)

```javascript
// server.js
var net = require('net'),
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    MQlobberServer = require('mqlobber').MQlobberServer,
    AccessControl = require('mqlobber-access-control').AccessControl,
    fsq = new QlobberFSQ();

fsq.on('start', function ()
{
    var server = net.createServer().listen(parseInt(process.argv[2]));
    server.on('connection', function (c)
    {
		new AccessControl(
		{
			publish: { allow: [ 'foo.bar.#' ],
					   disallow: [ 'foo.bar.reserved' ] },
			subscribe: { allow: [ 'foo.#' ] }
		}).attach(new MQlobberServer(fsq, c));
    });
});
```

Next, a program which connects to the server and subscribes to messages published to a topic:

```javascript
// client_subscribe.js
var assert = require('assert'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    c = require('net').createConnection(parseInt(process.argv[2])),
    mq = new MQlobberClient(c),
    topic = process.argv[3];

mq.subscribe(topic, function (s, info)
{
    var msg = '';
    s.on('readable', function ()
    {
        var data;
        while ((data = this.read()) !== null)
        {
            msg += data.toString();
        }
    });
    s.on('end', function ()
    {
        console.log('received', info.topic, msg);
        assert.equal(msg, 'hello');
        c.end();
    });
}, assert.ifError);
```

Finally, a program which connects to the server and publishes a message to a topic:

```javascript
// client_publish.js
var assert = require('assert'),
    MQlobberClient = require('mqlobber').MQlobberClient,
    c = require('net').createConnection(parseInt(process.argv[2])),
    mq = new MQlobberClient(c);

mq.publish(process.argv[3], function (err)
{
	assert.ifError(err);
    c.end();
}).end('hello');
```

Run two servers listening on ports 8600 and 8601:

```shell
$ node server.js 8600 &
$ node server.js 8601 &
```

Try to subscribe to topic `test`:

```shell
$ node client_subscribe.js 8600 test
[Error: blocked subscribe to topic: test]
assert.js:362
assert.ifError = function(err) { if (err) throw err; };
                                          ^

Error: server error
    at BPDuplex.<anonymous> (/tmp/wup/node_modules/mqlobber/lib/client.js:423:27)
    at emitTwo (events.js:87:13)
    at BPDuplex.emit (events.js:172:7)
    at BPMux._process_header (/tmp/wup/node_modules/mqlobber/node_modules/bpmux/index.js:652:20)
    at null.<anonymous> (/tmp/wup/node_modules/mqlobber/node_modules/bpmux/index.js:514:29)
    at emitNone (events.js:67:13)
    at emit (events.js:166:7)
    at emitReadable_ (_stream_readable.js:419:10)
    at emitReadable (_stream_readable.js:413:7)
    at readableAddChunk (_stream_readable.js:164:13)
```

Subscribe to two topics, `foo.bar` and wildcard topic `foo.*`, one against each
server:

```shell
$ node client_subscribe.js 8600 foo.bar &
$ node client_subscribe.js 8601 'foo.*' &
```

Try to publish to topic `foo.bar.reserved`:

```shell
$ node client_publish.js 8600 foo.bar.reserved
node client_publish.js 8600 foo.bar.reserved
[Error: blocked publish to topic: foo.bar.reserved]
assert.js:362
assert.ifError = function(err) { if (err) throw err; };
                                          ^

Error: server error
    at BPDuplex.<anonymous> (/tmp/wup/node_modules/mqlobber/lib/client.js:633:27)
    at emitTwo (events.js:87:13)
    at BPDuplex.emit (events.js:172:7)
    at BPMux._process_header (/tmp/wup/node_modules/mqlobber/node_modules/bpmux/index.js:652:20)
    at null.<anonymous> (/tmp/wup/node_modules/mqlobber/node_modules/bpmux/index.js:514:29)
    at emitNone (events.js:67:13)
    at emit (events.js:166:7)
    at emitReadable_ (_stream_readable.js:419:10)
    at emitReadable (_stream_readable.js:413:7)
    at readableAddChunk (_stream_readable.js:164:13)
```

Then publish a message to the topic `foo.bar`:

```shell
$ node client_publish.js 8600 foo.bar
received foo.bar hello
received foo.bar hello

[3]-  Done                    node client_subscribe.js 8600 foo.bar
[4]+  Done                    node client_subscribe.js 8601 'foo.*'
```

Only the servers should still be running and you can now terminate them:

```shell
$ jobs
[1]-  Running                 node server.js 8600 &
[2]+  Running                 node server.js 8601 &
$ kill %1 %2
[1]-  Terminated              node server.js 8600
[2]+  Terminated              node server.js 8601
```

## Installation

```shell
npm install mqlobber-access-control
```

## Licence

[MIT](LICENCE)

## Test

```shell
grunt test
```

## Lint

```shell
grunt lint
```

## Code Coverage

```shell
grunt coverage
```

[Instanbul](http://gotwarlost.github.io/istanbul/) results are available [here](http://rawgit.davedoesdev.com/davedoesdev/mqlobber-access-control/master/coverage/lcov-report/index.html).

Coveralls page is [here](https://coveralls.io/r/davedoesdev/mqlobber-access-control).

#API
*/
"use strict";

var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    Transform = require('stream').Transform,
    QlobberDedup = require('qlobber').QlobberDedup,
    blocked_matcher = new QlobberDedup();

function filter(info, handlers, cb)
{
    var blocked_handlers = blocked_matcher.match(info.topic),
        new_handlers;

    if (blocked_handlers.size === 0)
    {
        /*jshint validthis: true */
        return this.mqlobber_access_control_prev_filter(info, handlers, cb);
    }

    function allow(handler)
    {
        if (blocked_handlers.has(handler))
        {
            var server = handler.mqlobber_server,
                access_control = server.mqlobber_access_control;

            access_control.emit('message_blocked', info.topic, server);

            return false;
        }

        return true;
    }

    if (Array.isArray(handlers))
    {
        new_handlers = handlers.filter(allow);
    }
    else
    {
        new_handlers = new Set();

        for (var handler of handlers)
        {
            if (allow(handler))
            {
                new_handlers.add(handler);
            }
        }
    }

    /*jshint validthis: true */
    this.mqlobber_access_control_prev_filter(info, new_handlers, cb);
}

function allow(matchers, topic)
{
    if (matchers.disallow &&
        matchers.disallow.match(topic).size > 0)
    {
        return false;
    }

    if (matchers.allow &&
        matchers.allow.match(topic).size === 0)
    {
        return false;
    }

    return true;
}

/**
Create a new `AccessControl` object for applying access control on publish
and subscribe requests to [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) objects and messages delivered to
clients.

Calls [`reset`](#accesscontrolprototyperesetoptions) after creating the object.

@constructor

@param {Object} options See [`reset`](#accesscontrolprototyperesetoptions) for valid options.
*/
function AccessControl(options)
{
    EventEmitter.call(this);

    var ths = this;

    this._pre_subscribe_requested = function (topic, done)
    {
        if (ths._max_topic_length && (topic.length > ths._max_topic_length))
        {
            done(new Error('subscribe topic longer than ' +
                           ths._max_topic_length));
            return ths.emit('subscribe_blocked', topic, this);
        }

        if (!allow(ths._matchers.subscribe, topic))
        {
            done(new Error('blocked subscribe to topic: ' + topic));
            return ths.emit('subscribe_blocked', topic, this);
        }

        if (ths._max_subscriptions &&
            (this.subs.size >= ths._max_subscriptions) &&
            !this.subs.has(topic))
        {
            done(new Error('subscription limit ' + ths._max_subscriptions +
                           ' already reached: ' + topic));
            return ths.emit('subscribe_blocked', topic, this);
        }

        if (!ths.emit('subscribe_requested', this, topic, done) &&
            !this.emit('subscribe_requested', topic, done))
        {
            this.subscribe(topic, done);
        }
    };

    this._pre_unsubscribe_requested = function (topic, done)
    {
        if (ths._max_topic_length && (topic.length > ths._max_topic_length))
        {
            done(new Error('unsubscribe topic longer than ' +
                           ths._max_topic_length));
            return ths.emit('unsubscribe_blocked', topic, this);
        }
        
        if (!ths.emit('unsubscribe_requested', this, topic, done) &&
            !this.emit('unsubscribe_requested', topic, done))
        {
            this.unsubscribe(topic, done);
        }
    };

    this._pre_publish_requested = function (topic, duplex, options, done)
    {
        if (ths._max_topic_length && (topic.length > ths._max_topic_length))
        {
            done(new Error('publish topic longer than ' +
                           ths._max_topic_length));
            return ths.emit('publish_blocked', topic, this);
        }

        if (!allow(ths._matchers.publish, topic))
        {
            done(new Error('blocked publish to topic: ' + topic));
            return ths.emit('publish_blocked', topic, this);
        }

        var server = this;

        if (ths._max_publications &&
            (server.mqlobber_access_control_publish_count >=
             ths._max_publications))
        {
            done(new Error('publication limit ' + ths._max_publications +
                           ' already reached: ' + topic));
            return ths.emit('publish_blocked', topic, this);
        }

        server.mqlobber_access_control_publish_count += 1;

        var decrement = function (err, data)
        {
            server.mqlobber_access_control_publish_count -= 1;
            done(err, data);
        }

        function done2(err, data)
        {
            var dec = decrement;
            decrement = done; // only decrement once
            dec(err, data);
        }

        if (ths._max_publish_data_length)
        {
            var t = new Transform(),
                count = 0;

            t.on('error', this.relay_error);
            t.on('error', done2);
            
            t._transform = function (chunk, enc, cont)
            {
                count += chunk.length;

                if (count > ths._max_publish_data_length)
                {
                    return cont(new Error('message data exceeded limit ' +
                                          ths._max_publish_data_length + ': ' +
                                          topic));
                }

                this.push(chunk);
                cont();
            };

            duplex.pipe(t);
            duplex = t;
        }

        if (!ths.emit('publish_requested', this, topic, duplex, options, done2) &&
            !this.emit('publish_requested', topic, duplex, options, done2))
        {
            duplex.pipe(this.fsq.publish(topic, options, done2));
        }
    };

    this._blocked_topics = [];
    this._blocked_handlers = new Set();

    this.reset(options);
}

util.inherits(AccessControl, EventEmitter);

/**
Reset the access control applied by this object to client publish and subscribe
requests on attached [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) objects and messages delivered to clients.

@param {Object} options Specifies to which topics clients should be allowed and disallowed to publish, subscribe and receive messages. It supports the following
properties:

  - `{Object} [publish]` Allowed and disallowed topics for publish requests, with the following properties:
    - `{Array} [allow]` Clients can publish messages to these topics.
    - `{Array} [disallow]` Clients cannot publish messages to these topics.
    - `{Integer} [max_data_length]` Maximum number of bytes allowed in a published message.
    - `{Integer} [max_publications]` Maximum number of messages each client can publish at any one time.

  - `{Object} [subscribe]` Allowed and disallowed topics for subscribe requests, with the following properties:
    - `{Array} [allow]` Clients can subscribe to messages published to these topics.
    - `{Array} [disallow]` Clients cannot subscribe to messages published to these topics.
    - `{Integer} [max_subscriptions]` Maximum number of topics to which each client can be subscribed at any one time.

  - `{Array} [block]` Clients cannot receive messages published to these topics. This is useful if `subscribe.allow` is a superset of `subscribe.disallow` but you don't want messages matching (a subset of) `subscribe.disallow` sent to clients.

  - `{Integer} [max_topic_length]` Maximum topic length for publish, subscribe and unsubscribe requests.

Topics are the same as [`mqlobber` topics](https://github.com/davedoesdev/mqlobber#mqlobberclientprototypesubscribetopic-handler-cb) and [`qlobber-fsq` topics](
https://github.com/davedoesdev/qlobber-fsq#qlobberfsqprototypesubscribetopic-handler-cb). They're split into words using `.` as the separator. You can use `*`
to match exactly one word in a topic or `#` to match zero or more words.
For example, `foo.*` would match `foo.bar` whereas `foo.#` would match `foo`,
`foo.bar` and `foo.bar.wup`. Note these are the default separator and wildcard
characters. They can be changed when [constructing the `QlobberFSQ` instance]
(https://github.com/davedoesdev/qlobber-fsq#qlobberfsqoptions) passed to
[`MQlobberServer`'s constructor](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options).

Note that for subscribe requests, `AccessControl` matches topics you specify
here against topics in the requests, which can themselves contain
wildcard specifiers.

Disallowed topics take precedence over allowed ones. So if a topic in a
publish or subscribe request matches a disallowed topic specifier, it's blocked
even if it also matches an allowed topic specifier.

Access control is only applied where topics are specified.
*/
AccessControl.prototype.reset = function (options)
{
    var ths = this, topic, handler;

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

    for (topic of this._blocked_topics)
    {
        for (handler of this._blocked_handlers)
        {
            blocked_matcher.remove(topic, handler);
        }
    }

    this._blocked_topics = options.block || [];

    for (topic of this._blocked_topics)
    {
        for (handler of this._blocked_handlers)
        {
            blocked_matcher.add(topic, handler);
        }
    }

    this._max_topic_length = options.max_topic_length;
    this._max_subscriptions = options.subscribe ?
            options.subscribe.max_subscriptions : 0;
    this._max_publish_data_length = options.publish ?
            options.publish.max_data_length : 0;
    this._max_publications = options.publish ?
            options.publish.max_publications : 0;
};

/**
Start applying access control to a [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object.

Only one `AccessControl` object can be attached to a `MQlobberServer` object at
a time. Trying to attach more than one will throw an exception.

@param {MQlobberServer} server Object to which to apply access control.
*/
AccessControl.prototype.attach = function (server)
{
    if (server.mqlobber_access_control)
    {
        throw new Error('server has access control');
    }

    server.on('pre_subscribe_requested', this._pre_subscribe_requested);
    server.on('pre_unsubscribe_requested', this._pre_unsubscribe_requested);
    server.on('pre_publish_requested', this._pre_publish_requested);

    for (var topic of this._blocked_topics)
    {
        blocked_matcher.add(topic, server.handler);
    }

    this._blocked_handlers.add(server.handler);

    if (server.fsq.filter !== filter)
    {
        server.fsq.mqlobber_access_control_prev_filter = server.fsq.filter;
        server.fsq.filter = filter;
    }

    server.mqlobber_access_control_publish_count = 0;

    server.mqlobber_access_control = this;
};

/**
Stop applying access control to a [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object.

@param {MQlobberServer} server Object to which to stop applying access control. 
*/
AccessControl.prototype.detach = function (server)
{
    server.removeListener('pre_subscribe_requested',
                          this._pre_subscribe_requested);
    server.removeListener('pre_publish_requested',
                          this._pre_publish_requested);

    for (var topic of this._blocked_topics)
    {
        blocked_matcher.remove(topic, server.handler);
    }

    this._blocked_handlers.delete(server.handler);

    delete server.mqlobber_access_control;
};

exports.AccessControl = AccessControl;
