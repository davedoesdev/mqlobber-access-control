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
    s.on('finish', function ()
    {
        c.end();
    });
    s.on('end', function ()
    {
        console.log('received', info.topic, msg);
        assert.equal(msg, 'hello');
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

[Istanbul](http://gotwarlost.github.io/istanbul/) results are available [here](http://rawgit.davedoesdev.com/davedoesdev/mqlobber-access-control/master/coverage/lcov-report/index.html).

Coveralls page is [here](https://coveralls.io/r/davedoesdev/mqlobber-access-control).

# API

<a name="tableofcontents"></a>

- <a name="toc_accesscontroloptions"></a>[AccessControl](#accesscontroloptions)
- <a name="toc_accesscontrolprototyperesetoptions"></a><a name="toc_accesscontrolprototype"></a>[AccessControl.prototype.reset](#accesscontrolprototyperesetoptions)
- <a name="toc_accesscontrolprototypeattachserver"></a>[AccessControl.prototype.attach](#accesscontrolprototypeattachserver)
- <a name="toc_accesscontrolprototypedetachserver"></a>[AccessControl.prototype.detach](#accesscontrolprototypedetachserver)
- <a name="toc_accesscontroleventssubscribe_blockedtopic-server"></a><a name="toc_accesscontrolevents"></a>[AccessControl.events.subscribe_blocked](#accesscontroleventssubscribe_blockedtopic-server)
- <a name="toc_accesscontroleventspublish_blockedtopic-server"></a>[AccessControl.events.publish_blocked](#accesscontroleventspublish_blockedtopic-server)
- <a name="toc_accesscontroleventsmessage_blockedtopic-server"></a>[AccessControl.events.message_blocked](#accesscontroleventsmessage_blockedtopic-server)

## AccessControl(options)

> Create a new `AccessControl` object for applying access control on publish
and subscribe requests to [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) objects and messages delivered to
clients.

Calls [`reset`](#accesscontrolprototyperesetoptions) after creating the object.

**Parameters:**

- `{Object} options` See [`reset`](#accesscontrolprototyperesetoptions) for valid options.

<sub>Go: [TOC](#tableofcontents)</sub>

<a name="accesscontrolprototype"></a>

## AccessControl.prototype.reset(options)

> Reset the access control applied by this object to client publish and subscribe
requests on attached [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) objects and messages delivered to clients.

**Parameters:**

- `{Object} options` Specifies to which topics clients should be allowed and disallowed to publish, subscribe and receive messages. It supports the following properties:
  - `{Object} [publish]` Allowed and disallowed topics for publish requests, with the following properties:
    - `{Array} [allow]` Clients can publish messages to these topics.
    - `{Array} [disallow]` Clients cannot publish messages to these topics.
    - `{Integer} [max_data_length]` Maximum number of bytes allowed in a published message.
    - `{Integer} [max_publications]` Maximum number of messages each client can publish at any one time.
    - `{Boolean} [disallow_single]` Whether to allow messages to be published to a single subscriber.
    - `{Boolean} [disallow_multi]` Whether to allow messages to be published to multiple subscribers.

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
`foo.bar` and `foo.bar.wup`.

Note these are the default separator and wildcard characters. They can be
changed when [constructing the `QlobberFSQ` instance](https://github.com/davedoesdev/qlobber-fsq#qlobberfsqoptions) or [`QlobberPG` instance](https://github.com/davedoesdev/qlobber-pg) passed to
[`MQlobberServer`'s constructor](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options). If you do change them, make sure you specify the
changed values in `options` too.

There's also a limit on the number of words and `#` words, imposed by
`Qlobber`. For defaults, see `max_words` and `max_wildcard_somes`
[here](https://github.com/davedoesdev/qlobber#qlobberoptions). You can change
the limits by specifying `max_words` and/or `max_wildcard_somes` in `options`.

Note also that for subscribe requests, `AccessControl` matches topics you
specify here against topics in the requests, which can themselves contain
wildcard specifiers.

Disallowed topics take precedence over allowed ones. So if a topic in a
publish or subscribe request matches a disallowed topic specifier, it's blocked
even if it also matches an allowed topic specifier.

Access control is only applied where topics are specified.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.prototype](#toc_accesscontrolprototype)</sub>

## AccessControl.prototype.attach(server)

> Start applying access control to a [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object.

Only one `AccessControl` object can be attached to a `MQlobberServer` object at
a time. Trying to attach more than one will throw an exception.

If a conflict is detected between `server`'s configuration and the
`AccessControl` object's configuration (for example different separators or
different word limit) then an exception will be thrown.

**Parameters:**

- `{MQlobberServer} server` Object to which to apply access control.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.prototype](#toc_accesscontrolprototype)</sub>

## AccessControl.prototype.detach(server)

> Stop applying access control to a [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object.

**Parameters:**

- `{MQlobberServer} server` Object to which to stop applying access control.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.prototype](#toc_accesscontrolprototype)</sub>

<a name="accesscontrolevents"></a>

## AccessControl.events.subscribe_blocked(topic, server)

> `subscribe_blocked` event

Emitted by an `AccessControl` object after it blocks a subscribe request from a
client.

**Parameters:**

- `{String} topic` The topic that was blocked.
- `{MQlobberServer} server` The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the subscription request.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.events](#toc_accesscontrolevents)</sub>

## AccessControl.events.publish_blocked(topic, server)

> `publish_blocked` event

Emitted by an `AccessControl` object after it blocks a publish request from a
client.

**Parameters:**

- `{String} topic` The topic that was blocked.
- `{MQlobberServer} server` The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the publication request.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.events](#toc_accesscontrolevents)</sub>

## AccessControl.events.message_blocked(topic, server)

> `message_blocked` event

Emitted by an `AccessControl` object after it blocks a message being sent to a
client.

**Parameters:**

- `{String} topic` The topic that was blocked.
- `{MQlobberServer} server` The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which was handling the message.

<sub>Go: [TOC](#tableofcontents) | [AccessControl.events](#toc_accesscontrolevents)</sub>

_&mdash;generated by [apidox](https://github.com/codeactual/apidox)&mdash;_
