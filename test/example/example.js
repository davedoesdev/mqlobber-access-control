var assert = require('assert'),
    cp = require('child_process'),
    path = require('path'),
    async = require('async');

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

function drain(p, cb)
{
    var stdout, stderr;

    read_all(p.stdout, function (v)
    {
        stdout = v;
    });
    read_all(p.stderr, function (v)
    {
        stderr = v;
    });

    p.on('close', function (code)
    {
        cb(code, stdout, stderr);
    });
}

describe('example', function ()
{
    it('subscribers should connect, be denied or receive message then disconnect', function (done)
    {
        this.timeout(10000);

        var count = 0,
            servers = [],
            base_port = 8700,
            first = true;

        async.times(2, function (n, next)
        {
            var p = cp.fork(path.join(__dirname, 'server.js'), [base_port + n], { silent: true });

            drain(p, function (code, stdout, stderr)
            {
                assert.equal(code, 0);
                assert.equal(stdout.length, 0);
                if (n === 0)
                {
                    var s = stderr.toString(),
                        pos1 = s.indexOf('blocked subscribe to topic: test'),
                        pos2 = s.indexOf('blocked publish to topic: foo.bar.reserved');
                    assert(pos1 > 0);
                    assert(pos2 > pos1);
                }
                else if (process.env.USE_QLOBBER_PG === '1')
                {
                    var s = stderr.toString(),
                        pos = s.indexOf('Error: stopped');

                    assert(pos === 0);
                }
                else
                {
                    assert.equal(stderr.length, 0);
                }
            });
            
            p.on('message', function (m)
            {
                var exits = 0;
                function exit()
                {
                    exits += 1;
                    if (exits === servers.length)
                    {
                        done();
                    }
                }

                switch (m)
                {
                    case 'listening':
                        next(null, this);
                        break;

                    case 'connect':
                        count += 1;
                        break;

                    case 'disconnect':
                        count -= 1;
                        if (count === 0)
                        {
                            if (!first)
                            {
                                for (var server of servers)
                                {
                                    server.on('close', exit);
                                    server.send('stop');
                                }
                            }
                            first = false;
                        }
                        break;
                }
            });
        }, function (err, svrs)
        {
            servers = svrs;

            drain(cp.fork(path.join(__dirname, 'client_subscribe.js'), [base_port, 'test'], { silent: true }), function (code, stdout, stderr)
            {
                assert.equal(code, 1);
                assert.equal(stdout.length, 0);
                assert(stderr.toString().indexOf('server error') >= 0);

                var p = cp.fork(path.join(__dirname, 'client_subscribe.js'), [base_port, 'foo.bar'], { silent: true });

                drain(p, function (code, stdout, stderr)
                {
                    assert.equal(code, 0);
                    assert.equal(stdout.toString(), 'received foo.bar hello\n');
                    assert.equal(stderr.length, 0);
                });
                
                p.on('message', function ()
                {
                    p = cp.fork(path.join(__dirname, 'client_subscribe.js'), [base_port + 1, 'foo.*'], { silent: true });
                    
                    drain(p, function (code, stdout, stderr)
                    {
                        assert.equal(code, 0);
                        assert.equal(stdout.toString(), 'received foo.bar hello\n');
                        assert.equal(stderr.length, 0);
                    });
                        
                    p.on('message', function ()
                    {
                        drain(cp.fork(path.join(__dirname, 'client_publish.js'), [base_port, 'foo.bar.reserved'], { silent: true }), function (code, stdout, stderr)
                        {
                            assert.equal(code, 1);
                            assert.equal(stdout.length, 0);
                            assert(stderr.toString().indexOf('server error') >= 0);
                            cp.fork(path.join(__dirname, 'client_publish.js'), [base_port, 'foo.bar']);
                        });
                    });
                });
            });
        });
    });
});
