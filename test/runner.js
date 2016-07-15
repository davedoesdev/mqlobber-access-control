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

    function sub_pub_unsub(mq, cb)
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
                mq.client.unsubscribe('foo.bar', undefined, cb);
            });
        }, function (err)
        {
            if (err) { return cb(err); }
            mq.client.publish('foo.bar', function (err)
            {
                if (err) { return cb(err); }
            }).end('bar');
        });
    }

    with_mqs(1, 'subscribe, publish and unsubscribe when empty access control is attached', function (mqs, cb)
    {
        var ac = new AccessControl();
        ac.attach(mqs[0].server);
        sub_pub_unsub(mqs[0], cb);
    });

    function blocked_sub_pub_unsub(mq, cb)
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

    }

    with_mqs(1, 'single-allowed access control should block subscribe and publish but not unsubscribe', function (mqs, cb)
    {
        var ac = new AccessControl(['some topic']);
        ac.attach(mqs[0].server);
        blocked_sub_pub_unsub(mqs[0], cb);
    });

    with_mqs(1, 'should not block with topic in allowed access control', function (mqs, cb)
    {
        var ac = new AccessControl(['foo.bar']);
        ac.attach(mqs[0].server);
        sub_pub_unsub(mqs[0], cb);
    });

    with_mqs(1, 'wildcard access control should block', function (mqs, cb)
    {
        var ac = new AccessControl(['*']);
        ac.attach(mqs[0].server);
        blocked_sub_pub_unsub(mqs[0], function (err)
        {
            if (err) { return cb(err); }
            ac.reset(['foo.*']);
            sub_pub_unsub(mqs[0], function (err)
            {
                if (err) { return cb(err); }
                ac.reset(['#']);
                sub_pub_unsub(mqs[0], cb);
            });
        });
    });

    // test how wildcards work

    // should not affect other mqs

});
};
