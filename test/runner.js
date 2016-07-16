/*jshint mocha: true */
"use strict";

var path = require('path'),
    stream = require('stream'),
    async = require('async'),
    rimraf = require('rimraf'),
    util = require('util'),
    mqlobber = require('mqlobber'),
    MQlobberClient = mqlobber.MQlobberClient,
    MQlobberServer = mqlobber.MQlobberServer,
    QlobberFSQ = require('qlobber-fsq').QlobberFSQ,
    access_control = require('..'),
    AccessControl = access_control.AccessControl,
    chai = require('chai'),
    expect = chai.expect;

var timeout = 5;
var num_queues = 10;

function read_all(s, cb)
{
    var bufs = [];

    s.on('end', function ()
    {
        if (cb)
        {
            cb(Buffer.concat(bufs));
        }
    });

    s.on('readable', function ()
    {
        while (true)
        {
            var data = this.read();
            if (data === null) { break; }
            bufs.push(data);
        }
    });
}

module.exports = function (type, connect_and_accept)
{
describe(type, function ()
{
    function with_mqs(n, description, f, mqit, options)
    {
        describe('mqs=' + n, function ()
        {
            this.timeout(timeout * 1000);

            var fsq, mqs, ended = false;

            before(function (cb)
            {
                var fsq_dir = path.join(path.dirname(require.resolve('qlobber-fsq')), 'fsq');
                rimraf(fsq_dir, cb);
            });

            before(function (cb)
            {
                fsq = new QlobberFSQ(util._extend(
                {
                    multi_ttl: timeout * 1000,
                    single_ttl: timeout * 2 * 1000
                }, options));

                fsq.on('start', function ()
                {
                    async.timesSeries(n, function (i, cb)
                    {
                        connect_and_accept(function (cs, ss)
                        {
                            var cmq = new MQlobberClient(cs),
                                smq = new MQlobberServer(fsq, ss,
                                      options === null ? options :
                                      util._extend(
                                      {
                                          send_expires: true
                                      }, options));

                            cmq.on('handshake', function ()
                            {
                                cb(null, {
                                    client: cmq,
                                    server: smq,
                                    client_stream: cs,
                                    server_stream: ss
                                });
                            });
                        });
                    }, function (err, v)
                    {
                        mqs = v;
                        cb(err);
                    });
                });
            });

            function end(cb)
            {
                if (ended)
                {
                    return cb();
                }
                ended = true;

                async.each(mqs, function (mq, cb)
                {
                    mq.client_stream.on('end', cb);
                    mq.server_stream.on('end', function ()
                    {
                        this.end();
                    });
                    mq.client_stream.end();
                }, function (err)
                {
                    fsq.stop_watching(function ()
                    {
                        cb(err);
                    });
                });
            }

            after(end);

            (mqit || it)(description, function (cb)
            {
                f.call(this, mqs, cb, end);
            });
        });
    }

    function sub_pub_unsub(mqs, cb)
    {
        var count = 0;

        function done()
        {
            count += 1;
            if (count === mqs.length * mqs.length)
            {
                async.each(mqs, function (mq, cb)
                {
                    mq.client.unsubscribe('foo.bar', undefined, cb);
                }, cb);
            }
            else if (count > mqs.length * mqs.length)
            {
                cb(new Error('called too many times'));
            }
        }

        async.each(mqs, function (mq, cb)
        {
            mq.client.subscribe('foo.bar', function (s, info)
            {
                expect(info.single).to.equal(false);
                expect(info.topic).to.equal('foo.bar');

                var now = Date.now(), expires = info.expires * 1000;

                expect(expires).to.be.above(now);
                expect(expires).to.be.below(now + timeout * 1000);

                read_all(s, function (v)
                {
                    expect(v.toString()).to.equal('bar');
                    done();
                });
            }, cb);
        }, function (err)
        {
            if (err) { return cb(err); }
            
            async.each(mqs, function (mq, cb)
            {
                mq.client.publish('foo.bar', cb).end('bar');
            }, function (err)
            {
                if (err) { return cb(err); }
            });
        });
    }

    with_mqs(num_queues, 'subscribe, publish and unsubscribe when empty access control is attached', function (mqs, cb)
    {
        var ac = new AccessControl();
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        sub_pub_unsub(mqs, cb);
    });

    function blocked_sub_pub_unsub(mqs, cb)
    {
        async.each(mqs, function (mq, cb)
        {
            var warnings = [];

            mq.server.on('warning', function (err, duplex)
            {
                expect(duplex).to.be.an.instanceof(stream.Duplex);
                warnings.push(err.message);
            });

            mq.client.subscribe('foo.bar', function ()
            {
                cb(new Error('should not be called'));
            }, function (err)
            {
                expect(err.message).to.equal('server error');
                mq.client.publish('foo.bar', function (err)
                {
                    expect(err.message).to.equal('server error');
                    mq.client.unsubscribe('foo.bar', undefined, function (err)
                    {
                        expect(warnings).to.eql(['blocked subscribe to topic: foo.bar',
                                                 'blocked publish to topic: foo.bar']);
                        cb(err);
                    });
                });
            });
        }, cb);
    }

    with_mqs(num_queues, 'single-allow access control should block subscribe and publish but not unsubscribe', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['some topic'] },
            subscribe: { allow: ['some topic'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        blocked_sub_pub_unsub(mqs, cb);
    });

    with_mqs(num_queues, 'should not block with topic in allowed access control', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['foo.bar'] },
            subscribe: { allow: ['foo.bar'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        sub_pub_unsub(mqs, cb);
    });

    with_mqs(num_queues, 'wildcard access control should block', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['*'] },
            subscribe: { allow: ['*'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        blocked_sub_pub_unsub(mqs, function (err)
        {
            if (err) { return cb(err); }
            ac.reset(
            {
                publish: { allow: ['foo.*'] },
                subscribe: { allow: ['foo.*'] }
            });
            sub_pub_unsub(mqs, function (err)
            {
                if (err) { return cb(err); }
                ac.reset(
                {
                    publish: { allow: ['#'] },
                    subscribe: { allow: ['#'] }
                });
                sub_pub_unsub(mqs, cb);
            });
        });
    });

    with_mqs(num_queues, 'should be able to detach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['something'] },
            subscribe: { allow: ['something'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        blocked_sub_pub_unsub(mqs, function (err)
        {
            if (err) { return cb(err); }
            for (var mq of mqs)
            {
                ac.detach(mq.server);
            }
            sub_pub_unsub(mqs, cb);
        });
    });

    with_mqs(num_queues, 'should support multiple allowed topics', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['something', 'foo.bar'] },
            subscribe: { allow: ['something', 'foo.bar'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        sub_pub_unsub(mqs, cb);
    });

    with_mqs(num_queues, 'should support disallowed topics', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: ['something', 'foo.bar'],
                       disallow: ['foo.*'] },
            subscribe: { allow: ['something', 'foo.bar'],
                         disallow: ['foo.*'] }
        });
        for (var mq of mqs)
        {
            ac.attach(mq.server);
        }
        blocked_sub_pub_unsub(mqs, function (err)
        {
            if (err) { return cb(err); }
            ac.reset(
            {
                publish: { allow: ['something', 'foo.bar'],
                           disallow: ['*'] },
                subscribe: { allow: ['something', 'foo.bar'],
                             disallow: ['*'] },
            });
            sub_pub_unsub(mqs, function (err)
            {
                if (err) { return cb(err); }
                ac.reset(
                {
                    publish: { allow: ['something', 'foo.bar'],
                               disallow: ['*', '#'] },
                    subscribe: { allow: ['something', 'foo.bar'],
                                 disallow: ['*', '#'] }
                });
                blocked_sub_pub_unsub(mqs, cb);
            });
        });
    });

    with_mqs(num_queues * 2, 'should not affect unattached message queues',
    function (mqs, cb)
    {
        var mqs1 = mqs.slice(0, num_queues),
            mqs2 = mqs.slice(num_queues),
            ac = new AccessControl(
            {
                publish: { allow: [] },
                subscribe: { allow: [] }
            });
         
        for (var mq of mqs1)
        {
            ac.attach(mq.server);
        }

        async.parallel([
            function (cb)
            {
                blocked_sub_pub_unsub(mqs1, cb);
            },
            function (cb)
            {
                sub_pub_unsub(mqs2, cb);
            }], cb);
    });

    with_mqs(1, 'should apply access control separately to publish and subscribe', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'],
                         disallow: ['foo.bar'] },
            publish: { allow: ['foo.bar'],
                       disallow: ['foo.hello'] }
        });

        var mq = mqs[0], warnings = [], blocked = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err.message);
        });

        ac.on('subscribe_blocked', function (topic)
        {
            blocked.push('subscribe ' + topic);
        });

        ac.on('publish_blocked', function (topic)
        {
            blocked.push('publish ' + topic);
        });

        mq.client.subscribe('foo.bar', function ()
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            expect(err.message).to.equal('server error');
            mq.client.subscribe('foo.#', function (s)
            {
                read_all(s, function (v)
                {
                    expect(v.toString()).to.equal('bar');
                    expect(warnings).to.eql([
                        'blocked subscribe to topic: foo.bar',
                        'blocked publish to topic: foo.hello']);
                    expect(blocked).to.eql([
                        'subscribe foo.bar',
                        'publish foo.hello']);
                    cb();
                });
            }, function (err)
            {
                if (err) { return cb(err); }
                mq.client.publish('foo.hello', function (err)
                {
                    expect(err.message).to.equal('server error');
                    mq.client.publish('foo.bar', function (err)
                    {
                        if (err) { return cb(err); }
                    }).end('bar');
                }).end('bar');
            });
        });
    });
});
};
