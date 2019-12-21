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
    config = require('config'),
    access_control = require('..'),
    _AccessControl = access_control.AccessControl,
    chai = require('chai'),
    expect = chai.expect;

var use_qlobber_pg = process.env.USE_QLOBBER_PG === '1';

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
describe(type + ', use_qlobber_pg=' + use_qlobber_pg, function () {
function test(gopts) {
    function t(topic) {
        if (gopts) {
            if (gopts.separator) {
                topic = topic.split('.').join(gopts.separator);
            }
            if (gopts.wildcard_one) {
                topic = topic.split('*').join(gopts.wildcard_one);
            }
            if (gopts.wildcard_some) {
                topic = topic.split('#').join(gopts.wildcard_some);
            }
        }
        return topic;
    }

    class AccessControl extends _AccessControl
    {
        constructor(options)
        {
            super(Object.assign({}, gopts, options));
        }

        reset(options)
        {
            super.reset(Object.assign({}, gopts, options));
        }
    }

describe(`options=${JSON.stringify(gopts)}`, function () {
    function with_mqs(n, description, f, mqit, options)
    {
        describe('mqs=' + n, function ()
        {
            this.timeout(timeout * 1000);

            var fsq, mqs, ended = false;

            if (!use_qlobber_pg)
            {
                before(function (cb)
                {
                    var fsq_dir = path.join(path.dirname(require.resolve('qlobber-fsq')), 'fsq');
                    rimraf(fsq_dir, cb);
                });
            }

            before(function (cb)
            {
                var opts = Object.assign({}, gopts,
                {
                    multi_ttl: timeout * 1000,
                    single_ttl: timeout * 2 * 1000,
                }, options);
 
                if (use_qlobber_pg)
                {
                    var QlobberPG = require('qlobber-pg').QlobberPG;
                    fsq = new QlobberPG(Object.assign(
                    {
                        name: 'test'
                    }, config, opts));
                }
                else
                {
                    fsq = new QlobberFSQ(opts);
                }

                fsq.on('start', function ()
                {
                    async.timesSeries(n, function (i, cb)
                    {
                        connect_and_accept(function (cs, ss)
                        {
                            var cmq = new MQlobberClient(cs, gopts),
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

                var need_to_unsubscribe = [];

                async.each(mqs, function (mq, cb)
                {
                    mq.server.removeAllListeners('unsubscribe_all_requested');

                    if (!mq.server._done)
                    {
                        mq.server.on('unsubscribe_all_requested', function ()
                        {
                            need_to_unsubscribe.push(mq);
                        });
                    }

                    if (type === 'tcp')
                    {
                        mq.server.on('error', function (err)
                        {
                            expect(err.message).to.equal('This socket has been ended by the other party');
                        });
                    }

                    mq.client_stream.on('end', cb);
                    mq.server_stream.on('end', function ()
                    {
                        this.end();
                    });
                    mq.client_stream.end();
                }, function (err)
                {
                    async.each(need_to_unsubscribe, function (mq, cb)
                    {
                        mq.server.unsubscribe(cb);
                    }, function (err2)
                    {
                        fsq.stop_watching(function ()
                        {
                            cb(err || err2);
                        });
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
                    mq.client.unsubscribe(t('foo.bar'), undefined, cb);
                }, cb);
            }
            else if (count > mqs.length * mqs.length)
            {
                cb(new Error('called too many times'));
            }
        }

        async.each(mqs, function (mq, cb)
        {
            mq.client.subscribe(t('foo.bar'), function (s, info)
            {
                expect(info.single).to.equal(false);
                expect(info.topic).to.equal(t('foo.bar'));

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
                mq.client.publish(t('foo.bar'), cb).end('bar');
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

    with_mqs(num_queues, 'subscribe, publish and unsubscribe when no access control is attached', function (mqs, cb)
    {
        sub_pub_unsub(mqs, cb);
    });

    with_mqs(num_queues, 'subscribe, publish and unsubscribe when empty access control is attached to one message queue', function (mqs, cb)
    {
        var ac = new AccessControl();
        ac.attach(mqs[0].server);
        sub_pub_unsub(mqs, cb);
    });

    with_mqs(num_queues, 'subscribe, publish and unsubscribe when another handler is attached to fsq', function (mqs, cb)
    {
        var ac = new AccessControl();
        ac.attach(mqs[0].server);

        mqs[0].server.fsq.subscribe(t('foo.bar'), function (data, info)
        {
            expect(info.topic).to.equal(t('foo.bar'));
            expect(data.toString()).to.equal('bar');
        });

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
                    expect(warnings).to.eql([`blocked subscribe to topic: ${t('foo.bar')}`,
                                             `blocked publish to topic: ${t('foo.bar')}`,
                                             'unexpected data']);
                    /*jshint validthis: true */
                    this.removeListener('warning', warning);
                    cb();
                }
            }

            mq.server.on('warning', warning);

            mq.client.subscribe(t('foo.bar'), function ()
            {
                cb(new Error('should not be called'));
            }, function (err)
            {
                expect(err.message).to.equal('server error');
                mq.client.publish(t('foo.bar'), function (err)
                {
                    expect(err.message).to.equal('server error');
                    mq.client.unsubscribe(t('foo.bar'), undefined, function (err)
                    {
                        if (err) { return cb(err); }
                        expect(warnings).to.eql([`blocked subscribe to topic: ${t('foo.bar')}`,
                                                 `blocked publish to topic: ${t('foo.bar')}`]);
                    });
                }).end('bar');
            });
        }, cb);
    }

    with_mqs(num_queues, 'single-allow access control should block subscribe and publish but not unsubscribe', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: [t('some topic')] },
            subscribe: { allow: [t('some topic')] }
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
            publish: { allow: [t('foo.bar')] },
            subscribe: { allow: [t('foo.bar')] }
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
            publish: { allow: [t('*')] },
            subscribe: { allow: [t('*')] }
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
                publish: { allow: [t('foo.*')] },
                subscribe: { allow: [t('foo.*')] }
            });
            sub_pub_unsub(mqs, function (err)
            {
                if (err) { return cb(err); }
                ac.reset(
                {
                    publish: { allow: [t('#')] },
                    subscribe: { allow: [t('#')] }
                });
                sub_pub_unsub(mqs, cb);
            });
        });
    });

    with_mqs(num_queues, 'should be able to detach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { allow: [t('something')] },
            subscribe: { allow: [t('something')] }
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
            publish: { allow: [t('something'), t('foo.bar')] },
            subscribe: { allow: [t('something'), t('foo.bar')] }
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
            publish: { allow: [t('something'), t('foo.bar')],
                       disallow: [t('foo.*')] },
            subscribe: { allow: [t('something'), t('foo.bar')],
                         disallow: [t('foo.*')] }
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
                publish: { allow: [t('something'), t('foo.bar')],
                           disallow: [t('*')] },
                subscribe: { allow: [t('something'), t('foo.bar')],
                             disallow: [t('*')] },
            });
            sub_pub_unsub(mqs, function (err)
            {
                if (err) { return cb(err); }
                ac.reset(
                {
                    publish: { allow: [t('something'), t('foo.bar')],
                               disallow: [t('*'), t('#')] },
                    subscribe: { allow: [t('something'), t('foo.bar')],
                                 disallow: [t('*'), t('#')] }
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
        var ac = new AccessControl(Object.assign({}, gopts,
        {
            subscribe: { allow: [t('foo.*')],
                         disallow: [t('foo.bar')] },
            publish: { allow: [t('foo.bar')],
                       disallow: [t('foo.hello')] }
        }));

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

        mq.client.subscribe(t('foo.bar'), function ()
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            expect(err.message).to.equal('server error');
            mq.client.subscribe(t('foo.#'), function (s)
            {
                read_all(s, function (v)
                {
                    expect(v.toString()).to.equal('bar');
                    expect(warnings).to.eql([
                        `blocked subscribe to topic: ${t('foo.bar')}`,
                        `blocked publish to topic: ${t('foo.hello')}`,
                        'unexpected data']);
                    expect(blocked).to.eql([
                        `subscribe ${t('foo.bar')}`,
                        `publish ${t('foo.hello')}`]);
                    cb();
                });
            }, function (err)
            {
                if (err) { return cb(err); }
                mq.client.publish(t('foo.hello'), function (err)
                {
                    expect(err.message).to.equal('server error');
                    mq.client.publish(t('foo.bar'), function (err)
                    {
                        if (err) { return cb(err); }
                    }).end('bar');
                }).end('bar');
            });
        });
    });

    with_mqs(1, 'should be able to prevent publishing single messages', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { disallow_single: true }
        });

        var mq = mqs[0], warnings = [], blocked = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err.message);
        });

        ac.on('publish_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            blocked.push('publish ' + topic);
        });

        mq.client.subscribe(t('foo.bar'), function (s, info, done)
        {
            expect(info.topic).to.equal(t('foo.bar'));
            expect(info.single).to.equal(false);

            expect(warnings).to.eql([
                `blocked publish (single) to topic: ${t('foo.bar')}`,
                'unexpected data']);
            expect(blocked).to.eql([`publish ${t('foo.bar')}`]);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                done();
                cb();
            });
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.publish(t('foo.bar'), {single: true}, function (err)
            {
                expect(err.message).to.equal('server error');
                mq.client.publish(t('foo.bar'), function (err)
                {
                    if (err) { return cb(err); }
                }).end('bar');
            }).end('bar');
        });
    });

    with_mqs(1, 'should be able to prevent publishing multi messages', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            publish: { disallow_multi: true }
        });

        var mq = mqs[0], warnings = [], blocked = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err.message);
        });

        ac.on('publish_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            blocked.push('publish ' + topic);
        });

        mq.client.subscribe(t('foo.bar'), function (s, info, done)
        {
            expect(info.topic).to.equal(t('foo.bar'));
            expect(info.single).to.equal(true);

            expect(warnings).to.eql([
                `blocked publish (multi) to topic: ${t('foo.bar')}`,
                'unexpected data']);
            expect(blocked).to.eql([`publish ${t('foo.bar')}`]);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                done();
                cb();
            });
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.publish(t('foo.bar'), function (err)
            {
                expect(err.message).to.equal('server error');
                mq.client.publish(t('foo.bar'), {single: true}, function (err)
                {
                    if (err) { return cb(err); }
                }).end('bar');
            }).end('bar');
        });
    });

    with_mqs(1, 'should by default send messages matching subscribe.allow to clients even if they match subscribe.disallow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')],
                         disallow: [t('foo.bar')] }
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        mq.client.subscribe(t('foo.*'), function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal(t('foo.bar'));

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should support preventing messages matching block being sent to clients even if they match subscribe.allow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal(t('foo.bar'));
            setTimeout(cb, 1000);
        });

        mq.client.subscribe(t('foo.*'), function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'block should allow through non-matching messages if they match subscribe.allow', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe(t('foo.*'), function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal(t('foo.test'));

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish(t('foo.test')).end('bar');
    });

    with_mqs(1, 'should unblock when detach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var mq = mqs[0];

        ac.attach(mq.server);
        ac.detach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe(t('foo.*'), function (s, info)
        {
            expect(info.single).to.equal(false);
            expect(info.topic).to.equal(t('foo.bar'));

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
                cb();
            });
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should still block when reset', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')],
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        ac.reset(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal(t('foo.bar'));
            setTimeout(cb, 1000);
        });

        mq.client.subscribe(t('foo.*'), function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should guard against attaching access control to a server more than once', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var mq = mqs[0];

        ac.attach(mq.server);

        expect(function ()
        {
            ac.attach(mq.server);
        }).to.throw('server has access control');

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal(t('foo.bar'));
            setTimeout(cb, 1000);
        });

        mq.client.subscribe(t('foo.*'), function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(2, 'should guard against attaching access control servers with mismatching config', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        ac.attach(mqs[0].server);

        var ac2 = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')],
            separator: 'A'
        });

        expect(function ()
        {
            ac2.attach(mqs[1].server);
        }).to.throw('options mismatch');

        cb();
    });

    with_mqs(1, 'should be able to reattach', function (mqs, cb)
    {
        var ac = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var mq = mqs[0];

        ac.attach(mq.server);
        ac.detach(mq.server);
        ac.attach(mq.server);

        ac.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mq.server);
            expect(topic).to.equal(t('foo.bar'));
            setTimeout(cb, 1000);
        });

        mq.client.subscribe(t('foo.*'), function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(2, 'should support attaching to different servers with different block policy', function (mqs, cb)
    {
        var ac1 = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.bar')]
        });

        var ac2 = new AccessControl(
        {
            subscribe: { allow: [t('foo.*')] },
            block: [t('*.test')]
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
            expect(topic).to.equal(t('foo.bar'));
            blocked1 = true;
            check();
        });

        ac2.on('message_blocked', function (topic, server)
        {
            expect(server).to.equal(mqs[1].server);
            expect(topic).to.equal(t('foo.test'));
            blocked2 = true;
            check();
        });

        mqs[0].client.subscribe(t('foo.*'), function (s, info)
        {
            expect(info.topic).to.equal(t('foo.test'));
            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
            });
        });

        mqs[1].client.subscribe(t('foo.*'), function (s, info)
        {
            expect(info.topic).to.equal(t('foo.bar'));
            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');
            });
        });

        mqs[0].client.publish(t('foo.bar')).end('bar');
        mqs[0].client.publish(t('foo.test')).end('bar');
    });

    with_mqs(1, 'should re-emit publish_requested, subscribe_requested and unsubscribe_requested events', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            pub_event = false,
            sub_event = false,
            unsub_event = false;

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            sub_event = true;
            server.subscribe(topic, cb);
        });

        ac.on('unsubscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            unsub_event = true;
            server.unsubscribe(topic, cb);
        });

        ac.on('publish_requested', function (server, topic, stream, options, cb)
        {
            expect(topic).to.equal(t('foo.bar'));
            pub_event = true;
            stream.pipe(server.fsq.publish(topic, options, cb));
        });

        mq.server.on('subscribe_requested', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('unsubscribe_requested', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('publish_requested', function ()
        {
            cb(new Error('should not be called'));
        });

        mq.client.subscribe(t('foo.*'), function sub(s, info)
        {
            expect(info.topic).to.equal(t('foo.bar'));

            expect(pub_event).to.equal(true);
            expect(sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');

                mq.client.unsubscribe(t('foo.*'), sub, function (err)
                {
                    expect(unsub_event).to.equal(true);
                    cb();
                });
            });
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should emit publish_requested, subscribe_requested and unsubscribe_requested events on MQlobberServer', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            mq_pub_event = false,
            mq_sub_event = false,
            mq_unsub_event = false;

        ac.attach(mq.server);

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            mq_sub_event = true;
            this.subscribe(topic, cb);
        });

        mq.server.on('unsubscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            mq_unsub_event = true;
            this.unsubscribe(topic, cb);
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            expect(topic).to.equal(t('foo.bar'));
            mq_pub_event = true;
            stream.pipe(this.fsq.publish(topic, options, cb));
        });

        mq.client.subscribe(t('foo.*'), function sub(s, info)
        {
            expect(info.topic).to.equal(t('foo.bar'));

            expect(mq_pub_event).to.equal(true);
            expect(mq_sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');

                mq.client.unsubscribe(t('foo.*'), sub, function (err)
                {
                    expect(mq_unsub_event).to.equal(true);
                    cb();
                });
            });
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should support code emitting publish_requested, subscribe_requested and unsubscribe_requested events on MQlobberServer', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            pub_event = false,
            sub_event = false,
            unsub_event = false,
            mq_pub_event = false,
            mq_sub_event = false,
            mq_unsub_event = false;

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            sub_event = true;
            server.emit('subscribe_requested', topic, cb);
        });

        ac.on('unsubscribe_requested', function (server, topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            unsub_event = true;
            server.emit('unsubscribe_requested', topic, cb);
        });

        ac.on('publish_requested', function (server, topic, stream, options, cb)
        {
            expect(topic).to.equal(t('foo.bar'));
            pub_event = true;
            server.emit('publish_requested', topic, stream, options, cb);
        });

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            mq_sub_event = true;
            this.subscribe(topic, cb);
        });

        mq.server.on('unsubscribe_requested', function (topic, cb)
        {
            expect(topic).to.equal(t('foo.*'));
            mq_unsub_event = true;
            this.unsubscribe(topic, cb);
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            expect(topic).to.equal(t('foo.bar'));
            mq_pub_event = true;
            stream.pipe(this.fsq.publish(topic, options, cb));
        });

        mq.client.subscribe(t('foo.*'), function sub(s, info)
        {
            expect(info.topic).to.equal(t('foo.bar'));

            expect(pub_event).to.equal(true);
            expect(sub_event).to.equal(true);
            expect(mq_pub_event).to.equal(true);
            expect(mq_sub_event).to.equal(true);

            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('bar');

                mq.client.unsubscribe(t('foo.*'), sub, function (err)
                {
                    expect(unsub_event).to.equal(true);
                    expect(mq_unsub_event).to.equal(true);
                    cb();
                });
            });
        });

        mq.client.publish(t('foo.bar')).end('bar');
    });

    with_mqs(1, 'should not emit publish_requested and subscribe_requested events on MQlobberServer when requests are blocked', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                publish: { allow: [t('some topic')] },
                subscribe: { allow: [t('some topic')] }
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

        mq.client.subscribe(t('foo.*'), function (s, info)
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            expect(err.message).to.equal('server error');
            mq.client.publish(t('foo.bar'), function (err)
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

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            cb(new Error('should not be called'));
        });

        ac.on('unsubscribe_requested', function (server, topic, cb)
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

        mq.server.on('unsubscribe_requested', function (topic, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        function f()
        {
            cb(new Error('should not be called'));
        }

        mq.client.subscribe(t('foo'), f, function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('subscribe topic longer than 2');
            mq.client.publish(t('foo'), function (err)
            {
                expect(err.message).to.equal('server error');
                expect(warnings[1].message).to.equal('publish topic longer than 2');
                setTimeout(function ()
                {
                    expect(warnings[2].message).to.equal('unexpected data');
                    mq.client.subs.set(t('foo'), new Set([f]));
                    mq.client.unsubscribe(t('foo'), f, function (err)
                    {
                        expect(err.message).to.equal('server error');
                        expect(warnings[3].message).to.equal('unsubscribe topic longer than 2'); 
                        cb();
                    });
                }, 500);
            }).write('bar');
        });
    });

    with_mqs(1, 'should limit words in topic', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            warnings = [],
            topic = t(new Array(101).join('.'));

        expect(function ()
        {
            new AccessControl({ max_words: 99 }).attach(mq.server);
        }).to.throw('options mismatch');

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            cb(new Error('should not be called'));
        });

        ac.on('unsubscribe_requested', function (server, topic, cb)
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

        mq.server.on('unsubscribe_requested', function (topic, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        function f()
        {
            cb(new Error('should not be called'));
        }

        mq.client.subscribe(topic, f, function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('subscribe too many words');
            mq.client.publish(topic, function (err)
            {
                expect(err.message).to.equal('server error');
                expect(warnings[1].message).to.equal('publish too many words');
                setTimeout(function ()
                {
                    expect(warnings[2].message).to.equal('unexpected data');
                    mq.client.subs.set(topic, new Set([f]));
                    mq.client.unsubscribe(topic, f, function (err)
                    {
                        expect(err.message).to.equal('server error');
                        expect(warnings[3].message).to.equal('unsubscribe too many words'); 
                        cb();
                    });
                }, 500);
            }).write('bar');
        });
    });

    with_mqs(1, 'should limit wildcard somes in topic', function (mqs, cb)
    {
        var ac = new AccessControl(),
            mq = mqs[0],
            warnings = [],
            topic = t(new Array(4).fill('#').join('.')),
            ptopic = topic;

        if (use_qlobber_pg)
        {
            // psql can't use wildcards as publish topics
            ptopic = t(new Array(4).fill('X').join('.'));
        }

        expect(function ()
        {
            new AccessControl({ max_wildcard_somes: 5 }).attach(mq.server);
        }).to.throw('options mismatch');

        ac.attach(mq.server);

        ac.on('subscribe_requested', function (server, topic, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('subscribe_requested', function (topic, cb)
        {
            cb(new Error('should not be called'));
        });

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        function f()
        {
            cb(new Error('should not be called'));
        }

        mq.client.subscribe(topic, f, function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('subscribe too many wildcard somes');
            mq.client.publish(topic, function (err)
            {
                if (err) { return cb(err); }
                setTimeout(function ()
                {
                    mq.client.subs.set(topic, new Set([f]));
                    mq.client.unsubscribe(topic, f, function (err)
                    {
                        if (err) { return cb(err); }
                        cb();
                    });
                }, 500);
            }).end('bar');
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

        mq.client.subscribe(t('foo'), function ()
        {
            cb(new Error('should not be called'));
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.subscribe(t('bar'), function ()
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

    with_mqs(1, 'should be able to limit number of publications', function (mqs, cb)
    {
        var ac = new AccessControl(
            {
                publish: {
                    max_publications: 1
                }
            }),
            mq = mqs[0],
            warnings = [];

        ac.attach(mq.server);

        mq.server.on('warning', function (err)
        {
            warnings.push(err);
        });

        mq.client.subscribe(t('foo2'), function (s, info)
        {
            expect(info.topic).to.equal(t('foo2'));
            read_all(s, function (v)
            {
                expect(v.toString()).to.equal('foo2');
                // check that bar message doesn't arrive
                setTimeout(cb, 500);
            });
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.subscribe(t('foo'), function (s, info)
            {
                expect(info.topic).to.equal(t('foo'));
                read_all(s, function (v)
                {
                    expect(v.toString()).to.equal('bar');
                    mq.client.publish(t('foo2'), function (err)
                    {
                        if (err) { cb(err); }
                    }).end('foo2');
                });
            }, function (err)
            {
                if (err) { return cb(err); }

                var s = mq.client.publish(t('foo'), function (err)
                {
                    if (err) { cb(err); }
                });
                
                s.write('bar');

                mq.client.publish(t('bar'), function (err)
                {
                    expect(err.message).to.equal('server error');
                    expect(warnings[0].message).to.equal(`publication limit 1 already reached: ${t('bar')}`);
                    s.end();
                }).end('bar2');
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

        var s = mq.client.publish(t('foo'), function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal(`message data exceeded limit 100: ${t('foo')}`);
            cb();
        });
        
        s.write(Buffer.alloc(50));
        s.end(Buffer.alloc(51));
    });

    with_mqs(1, 'client should get error if error occurs on limiting transform stream', function (mqs, cb)
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

        mq.server.on('publish_requested', function (topic, stream, options, cb)
        {
            expect(topic).to.equal(t('foo'));
            stream.emit('error', new Error('dummy'));
            cb();
        });

        mq.client.publish(t('foo'), function (err)
        {
            expect(err.message).to.equal('server error');
            expect(warnings[0].message).to.equal('dummy');
            cb();
        }).end();
    });
});
}
for (let dedup of [true, false]) {
    test({ dedup });
    test({
        dedup,
        separator: '/',
        wildcard_one: '+',
        wildcard_some: 'M'
    });
}
});
};
