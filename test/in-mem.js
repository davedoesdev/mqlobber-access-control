"use strict";

var common = require('./runner'),
    stream = require('stream'),
    util = require('util'),
    Duplex = stream.Duplex,
    PassThrough = stream.PassThrough;

function RightDuplex(left)
{
    Duplex.call(this);
    this.left = left;
}

util.inherits(RightDuplex, Duplex);

RightDuplex.prototype._final = function (cb)
{
    this.left.push(null);
    cb();
};

RightDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this.cb;
        this._cb = null;
        cb();
    }
};

RightDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.left.push(chunk, encoding))
    {
        cb();
    }
    else
    {
        this.left._cb = cb;
    }
};

function LeftDuplex()
{
    Duplex.call(this);
    this.right = new RightDuplex(this);
}

util.inherits(LeftDuplex, Duplex);

LeftDuplex.prototype._final = function (cb)
{
    this.right.push(null);
    cb();
};

LeftDuplex.prototype._read = function ()
{
    if (this._cb)
    {
        var cb = this._cb;
        this._cb = null;
        cb();
    }
};

LeftDuplex.prototype._write = function (chunk, encoding, cb)
{
    if (this.right.push(chunk, encoding))
    {
        cb();
    }
    else
    {
        this.right._cb = cb;
    }
};

function connect_and_accept(cb)
{
    var left = new LeftDuplex();
    cb(left, left.right);
}

common('in-memory', connect_and_accept);
