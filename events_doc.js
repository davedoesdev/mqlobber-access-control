/**
`subscribe_blocked` event

Emitted by an `AccessControl` object after it blocks a subscribe request from a
client.

@param {String} topic Topic that was blocked.
*/
AccessControl.events.subscribe_blocked = function (topic) {};

/**
`publish_blocked` event

Emitted by an `AccessControl` object after it blocks a publish request from a
client.
*/
AccessControl.events.publish_blocked = function (topic) {};

/**
`subscribe_requested` event

Emitted by an `AccessControl` object when an attached `MQlobberServer` object
receives a request from its peer `MQlobberClient` object to subscribe to
messages published to a topic.

If there are no listeners on this event, the default action is to call
[`server.subscribe(topic, cb)`](https://github.com/davedoesdev/mqlobber#mqlobberserverprototypesubscribetopic-cb).
If you add a listener on this event, the default action will _not_ be called.
This gives you the opportunity to filter subscription requests in the
application.

Please see the documentation for [`MQlobberServer.events.subscribe_requested`](https://github.com/davedoesdev/mqlobber#mqlobberservereventssubscribe_requestedtopic-cb). There is one extra parameter here, `server`, which is the `MQlobberServer` object.

@param {MQlobberServer} server The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the subscription request.

@param {String} topic The topic to which the client is asking to subscribe.

@param {Function} cb Function to call after processing the subscription request.
This function _must_ be called even if you don't call
[`server.subscribe`](https://github.com/davedoesdev/mqlobber#mqlobberserverprototypesubscribetopic-cb) yourself.
It takes a single argument:

  - `{Object} err` If `null` then a success status is returned to the client
      (whether you called [`server.subscribe`](https://github.com/davedoesdev/mqlobber#mqlobberserverprototypesubscribetopic-cb) or not).
          Otherwise, the client gets a failed status and a [`warning`](https://github.com/davedoesdev/mqlobber#mqlobberservereventswarningerr-obj) event is emitted with `err`.
*/
AccessControl.events.subscribe_requested = function (server, topic, cb) {};

/**
`publish_requested` event

Emitted by an `AccessControl` object when an attached `MQlobberServer` object
receives a requests from its peer `MQlobberClient` object to publish a message
to a topic.

If there are no listeners on this event, the default action is to call
`stream.pipe(server.fsq.publish(topic, options, cb))`

Please see the documentation for [`MQlobberServer.events.publish_requested`](https://github.com/davedoesdev/mqlobber#mqlobberservereventspublish_requestedtopic-stream-options-cb). There is one extra parameter here, `server`, which is the `MQlobberServer` object.

@param {MQlobberServer} server The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the publication request.

@param {String} topic The topic to which the message should be published.

@param {Readable} stream The message data as a [`Readable`](https://nodejs.org/d
ist/latest-v4.x/docs/api/stream.html#stream_class_stream_readable). 

@param {Object} options Optional settings for this publication:

  - `{Boolean} single` If `true` then the message should be published to
    _at most_ one client (across all servers). Otherwise, it should be published
    to all interested clients.
    
  - `{Integer} ttl` Time-to-live (in seconds) for this message.
  
@param {Function} cb Function to call after processing the publication
request. This function _must_ be called even if you don't call
[`server.fsq.publish`](https://github.com/davedoesdev/qlobber-fsq#qlobberfsqprototypepublishtopic-payload-options-cb) yourself. It takes a single
argument:

  - `{Object} err` If `null` then a success status is returned to the client
    (whether you called [`server.fsq.publish`](https://github.com/davedoesdev/qlobber-fsq#qlobberfsqprototypepublishtopic-payload-options-cb) or not).
    Otherwise, the client gets a failed status and a [`warning`](https://github.com/davedoesdev/mqlobber#mqlobberservereventswarningerr-obj) event is emitted with `err`.
*/
AccessControl.events.publish_requested = function (server, topic, stream, options, cb) {};

