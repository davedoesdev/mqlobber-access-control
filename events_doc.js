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
