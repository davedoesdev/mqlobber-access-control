/**
`subscribe_blocked` event

Emitted by an `AccessControl` object after it blocks a subscribe request from a
client.

@param {String} topic The topic that was blocked.

@param {MQlobberServer} server The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the subscription request.
*/
AccessControl.events.subscribe_blocked = function (topic, server) {};

/**
`publish_blocked` event

Emitted by an `AccessControl` object after it blocks a publish request from a
client.

@param {String} topic The topic that was blocked.

@param {MQlobberServer} server The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which received the publication request.
*/
AccessControl.events.publish_blocked = function (topic, server) {};

/**
`message_blocked` event

Emitted by an `AccessControl` object after it blocks a message being sent to a
client.

@param {String} topic The topic that was blocked.

@param {MQlobberServer} server The [`MQlobberServer`](https://github.com/davedoesdev/mqlobber#mqlobberserverfsq-stream-options) object which was handling the message.
*/
AccessControl.events.message_blocked = function (topic, server) {};
