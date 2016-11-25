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
        }).attach(new MQlobberServer(fsq, c).on('error', console.error));
    });
//--------------------
    server.on('connection', function (c)
    {
        function disconnect()
        {
            if (process.send)
            {
                process.send('disconnect');
            }
        }

        c.on('end', disconnect);
        c.on('close', disconnect);

        if (process.send)
        {
            process.send('connect');
        }
    });

    server.on('listening', function ()
    {
        if (process.send)
        {
            process.send('listening');
        }
    });

    process.on('message', function ()
    {
        process.removeAllListeners('message');
        fsq.stop_watching();
        server.close();
    });
//--------------------
});
