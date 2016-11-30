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

var timeout = 30;
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
describe(type, function () {
function dedup(dedup) {
describe('dedup=' + dedup, function () {
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
                    single_ttl: timeout * 2 * 1000,
                    dedup: dedup
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

                expect(this).to.equal(mq.client);

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

            function warning(err, duplex)
            {
                expect(duplex).to.be.an.instanceof(stream.Duplex);
                warnings.push(err.message);

                if (err.message === 'unexpected data')
                {
                    expect(warnings).to.eql(['blocked subscribe to topic: foo.bar',
                                             'blocked publish to topic: foo.bar',
                                             'unexpected data']);
                    /*jshint validthis: true */
                    this.removeListener('warning', warning);
                    cb();
                }
            }

            mq.server.on('warning', warning);

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
                        if (err) { return cb(err); }
                        expect(warnings).to.eql(['blocked subscribe to topic: foo.bar',
                                                 'blocked publish to topic: foo.bar']);
                    });
                }).end('bar');
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

        ac.on('subscribe_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            blocked.push('subscribe ' + topic);
        });

        ac.on('publish_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
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
                        'blocked publish to topic: foo.hello',
                        'unexpected data']);
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

    with_mqs(1, 'should by default send messages matching subscribe.allow to clients even if they match subscribe.disallow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'],
                         disallow: ['foo.bar'] }
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal('foo.bar');

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should support preventing messages matching block being sent to clients even if they match subscribe.allow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal('foo.bar');
            setTimeout(cb, 1000);
        });

        mq.client.subscribe('foo.*', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'block should allow through non-matching messages if they match subscribe.allow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal('foo.test');

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.test').end('bar');
    });

    with_mqs(1, 'should unblock when detach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var mq = mqs[0];

        ac.attach(mq.server);
        ac.detach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal('foo.bar');

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should still block when reset', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar'],
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.reset(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal('foo.bar');
            setTimeout(cb, 1000);
        });

        mq.client.subscribe('foo.*', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should guard against attaching access control to a server more than once', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        expect(function ()
        {
            ac.attach(mq.server);
        }).to.throw(Error);

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal('foo.bar');
            setTimeout(cb, 1000);
        });

        mq.client.subscribe('foo.*', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should be able to reattach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var mq = mqs[0];

        ac.attach(mq.server);
        ac.detach(mq.server);
        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal('foo.bar');
            setTimeout(cb, 1000);
        });

        mq.client.subscribe('foo.*', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(2, 'should support attaching to different servers with different block policy', function (mqs, cb)
    {
        var ac1 = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.bar']
        });

        var ac2 = new AccessControl(
        {
            subscribe: { allow: ['foo.*'] },
            block: ['foo.test']
        });

        ac1.attach(mqs[0].server);
        ac2.attach(mqs[1].server);

        var blocked1 = false, blocked2 = false;

        function check()
        {
            if (blocked1 && blocked2)
            {
                setTimeout(cb, 1000);
            }
        }

        ac1.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mqs[0].server);
            expect(topic).to.equal('foo.bar');
            blocked1 = true;
            check();
        });

        ac2.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mqs[1].server);
            expect(topic).to.equal('foo.test');
            blocked2 = true;
            check();
        });

        mqs[0].client.subscribe('foo.*', function (s, info)
        {
            expect(info.topic).to.equal('foo.test');
        });

        mqs[1].client.subscribe('foo.*', function (s, info)
        {
            expect(info.topic).to.equal('foo.bar');
        });

        mqs[0].client.publish('foo.bar').end('bar');
        mqs[0].client.publish('foo.test').end('bar');
    });

    with_mqs(1, 'should re-emit publish_requested and subscribe_requested events', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            pub_event = false,
            sub_event = false;

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal('foo.*');
            sub_event = true;
            server.subscribe(topic, cb);
        });

        ac.on('publish_requested', function (server, topic, stream, options, cb)
        {
            expect(topic).to.equal('foo.bar');
            pub_event = true;
            stream.pipe(server.fsq.publish(topic, options, cb));
        });

        mq.server.on('subscribe_requested', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('publish_requested', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.topic).to.equal('foo.bar');

            expect(pub_event).to.equal(true);
            expect(sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should emit publish_requested and subscribe_requested events on MQlobberServer', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            mq_pub_event = false,
            mq_sub_event = false;

        ac.attach(mq.server);

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal('foo.*');
            mq_sub_event = true;
            this.subscribe(topic, cb);
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            expect(topic).to.equal('foo.bar');
            mq_pub_event = true;
            stream.pipe(this.fsq.publish(topic, options, cb));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.topic).to.equal('foo.bar');

            expect(mq_pub_event).to.equal(true);
            expect(mq_sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should support code emitting publish_requested and subscribe_requested events on MQlobberServer', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            pub_event = false,
            sub_event = false,
            mq_pub_event = false,
            mq_sub_event = false;

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal('foo.*');
            sub_event = true;
            server.emit('subscribe_requested', topic, cb);
        });

        ac.on('publish_requested', function (server, topic, stream, options, cb)
        {
            expect(topic).to.equal('foo.bar');
            pub_event = true;
            server.emit('publish_requested', topic, stream, options, cb);
        });

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal('foo.*');
            mq_sub_event = true;
            this.subscribe(topic, cb);
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            expect(topic).to.equal('foo.bar');
            mq_pub_event = true;
            stream.pipe(this.fsq.publish(topic, options, cb));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            expect(info.topic).to.equal('foo.bar');

            expect(pub_event).to.equal(true);
            expect(sub_event).to.equal(true);
            expect(mq_pub_event).to.equal(true);
            expect(mq_sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish('foo.bar').end('bar');
    });

    with_mqs(1, 'should not emit publish_requested and subscribe_requested events on MQlobberServer when requests are blocked', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                publish: { allow: ['some topic'] },
                subscribe: { allow: ['some topic'] }
            }),
            mq = mqs[0];

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            cb(new Error('should not be called'));
        });

        ac.on('publish_requested', function (server, topic, stream, options, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe('foo.*', function (s, info)
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            expect(err.message).to.equal('server error');
            mq.client.publish('foo.bar', function (err)
            {
                expect(err.message).to.equal('server error');
                setTimeout(cb, 2000);
            }).end('bar');
        });
    });

    with_mqs(1, 'should be able to limit topic length', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                max_topic_length: 2
            }),
            mq = mqs[0],
            warnings = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        function f()
        {
            cb(new Error('should not be called'));
        }

        mq.client.subscribe('foo', f, function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('subscribe topic longer than 2');
            mq.client.publish('foo', function (err)
            {
                expect(err.message).to.equal('server error');
                expect(warnings[1].message).to.equal('publish topic longer than 2');
                setTimeout(function ()
                {
                    expect(warnings[2].message).to.equal('unexpected data');
                    mq.client.subs.set('foo', new Set([f]));
                    mq.client.unsubscribe('foo', f, function (err)
                    {
                        expect(err.message).to.equal('server error');
                        expect(warnings[3].message).to.equal('unsubscribe topic longer than 2'); 
                        cb();
                    });
                }, 500);
            }).write('bar');
        });
    });

    with_mqs(1, 'should be able to limit number of subscriptions', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                subscribe: {
                    max_subscriptions: 1
                }
            }),
            mq = mqs[0],
            warnings = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        mq.client.subscribe('foo', function ()
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.subscribe('bar', function ()
            {
                cb(new Error('should not be called'));
            }, function (err)
            {
                expect(err.message).to.equal('server error');
                expect(warnings[0].message).to.equal('subscription limit 1 already reached: bar');
                cb();
            });
        });
    });

    with_mqs(1, 'should be able to limit message length', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                publish: {
                    max_data_length: 100
                }
            }),
            mq = mqs[0],
            warnings = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        var s = mq.client.publish('foo', function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('message data exceeded limit 100: foo');
            cb();
        });
        
        s.write(new Buffer(50));
        s.end(new Buffer(51));
    });
});
}
dedup(true);
dedup(false);
});
};
