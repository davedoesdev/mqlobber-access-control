var QlobberDedup = require('qlobber').QlobberDedup;

function AccessControl(allowed_topics, disallowed_topics)
{
    this._allowed_matcher = null;
    this._disallowed_matcher = null;

    var ths = this;

    function allowed(topic)
    {
        if (ths._disallowed_matcher &&
            ths._disallowed_matcher.match(topic).size > 0)
        {
            return false;
        }

        if (ths._allowed_matcher &&
            ths._allowed_matcher.match(topic).size === 0)
        {
            return false;
        }

        return true;
    }

    this._subscribe_requested = function (topic, done)
    {
        if (allowed(topic))
        {
            this.subscribe(topic, done);
        }
        else
        {
            done(new Error('blocked subscribe to topic: ' + topic));
        }
    };

    this._publish_requested = function (topic, duplex, options, done)
    {
        if (allowed(topic))
        {
            duplex.pipe(this.fsq.publish(topic, options, done));
        }
        else
        {
            done(new Error('blocked publish to topic: ' + topic));
        }
    };

    this.reset(allowed_topics, disallowed_topics);
}

AccessControl.prototype.reset = function (allowed_topics, disallowed_topics)
{
    var topic;

    if (allowed_topics &&
        typeof allowed_topics[Symbol.iterator] === 'function')
    {
        this._allowed_matcher = new QlobberDedup();
        for (topic of allowed_topics)
        {
            this._allowed_matcher.add(topic, true);
        }
    }
    else
    {
        this._allowed_matcher = null;
    }

    if (disallowed_topics &&
        typeof disallowed_topics[Symbol.iterator] === 'function')
    {
        this._disallowed_match = new QlobberDedup();
        for (topic of disallowed_topics)
        {
            this._disallowed_matcher.add(topic, true);
        }
    }
    else
    {
        this._disallowed_matcher = null;
    }
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
