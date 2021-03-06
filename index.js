/*!
 * morgan
 * Copyright(c) 2010 Sencha Inc.
 * Copyright(c) 2011 TJ Holowaychuk
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

// For formatting date in appropriate timezone;
const moment = require('moment-timezone');

/**
 * Module exports.
 * @public
 */

morgan.format = format;
morgan.token = token;

// allow for multiple loggers in app
let morganBodyUseCounter = 0;

module.exports = function(app, options) {
  // default options
  options = options || {};
  var maxBodyLength = options.hasOwnProperty('maxBodyLength') ? options.maxBodyLength : 1000;
  var logReqDateTime = options.hasOwnProperty('logReqDateTime') ? options.logReqDateTime : true;
  var logReqUserAgent = options.hasOwnProperty('logReqUserAgent') ? options.logReqUserAgent : true;
  var logRequestBody = options.hasOwnProperty('logRequestBody') ? options.logRequestBody : true;
  var logResponseBody = options.hasOwnProperty('logResponseBody') ? options.logResponseBody : true;
  if (logReqDateTime) {
    var dateTimeFormat = options.hasOwnProperty('dateTimeFormat') ? options.dateTimeFormat || '' : '';
    if (typeof dateTimeFormat !== 'string') throw new Error(`morgan-body was passed a non-string value for "dateTimeFormat" option, value passed was: ${dateTimeFormat}`);
    else {
      dateTimeFormat = dateTimeFormat.toLowerCase().trim();
      if (dateTimeFormat === 'gmt' || dateTimeFormat === 'utc') dateTimeFormat = ''; // GMT/UTC is default
      if (!['iso', 'clf', ''].some(function(value) { value === dateTimeFormat })) { // enum check
        new Error(`morgan-body was passed a value that was not one of 'iso', 'clf', 'utc' or 'gmt' for "dateTimeFormat" option, value passed was: ${options.dateTimeFormat}`);
      }
    }

    if (dateTimeFormat === "local") {
      let timezone = options.hasOwnProperty("timezone") ? options.timezone || '' : '';
      if (!moment.tz.zone(timezone)) {
        // If passed timezone is not understood by momentjs use localtimezone
        let guessTimezone = moment.tz.guess();
        if (timezone)
          new Error(`morgan-body was passed a value for "timezone" option that was valid (value passed was : ${timezone}. Using the guessed value : ${guessTimezone}`);
        timezone = guessTimezone;
      }
      dateTimeFormat = `local,${timezone}`;
    }
  } else if(options.dateTimeFormat) {
    console.log(`WARNING: option "dateTimeFormat" was provided to morgan-body even though option "logReqDateTime" was set to false, value passed was: ${options.dateTimeFormat}`)
  }

  const reqLogType = `dev-req${!logReqUserAgent ? '-nouseragent' : ''}${!logReqDateTime ? '-nodatetime' : ''}`;

  // allow up to 100 loggers, likely way more than needed need to reset counter
  // at a cutoff to avoid memory leak for developing when app live reloads
  morganBodyUseCounter = (morganBodyUseCounter + 1) % 100;
  var formatName = `dev-req-${morganBodyUseCounter}`;

  morgan.format(formatName, function developmentFormatLine(tokens, req, res) {
    // compile and memoize
    var formatString = '\x1b[96mRequest: \x1b[93m:method \x1b[97m:url';
    if (logReqDateTime) formatString += ' \x1b[90mat \x1b[37m:date';
    if (dateTimeFormat) formatString += `[${dateTimeFormat}]`;
    if (logReqDateTime && logReqUserAgent) formatString += ',';
    if (logReqUserAgent) formatString += ' \x1b[90mUser Agent: :user-agent\x1b[0m';

    var fn = developmentFormatLine.func = developmentFormatLine.func || compile(formatString);
    return fn(tokens, req, res);
  });

  // log when request comes in
  app.use(morgan(formatName, { immediate: true }));

  if (logRequestBody || logResponseBody) {
    function logBody(prependStr, body) {
      var bodyType = typeof body;
      var isObj = body !== null && bodyType === 'object';
      var isString = bodyType === 'string';
      var parseFailed = false;

      if (isString) {
        try {
          body = JSON.parse(body);
          bodyType = typeof body;
          isObj = body !== null && bodyType === 'object';
          isString = bodyType === 'string';
        } catch(e) { }
      }

      if (body instanceof Buffer) {
        body = '<Buffer>';
        bodyType = 'string';
        isObj = false;
        isString = true;
      }

      if (!isObj && !isString && body !== undefined) {
        body = ""+body; // coerce to string if primitive
        isString = true;
      }

      if (isString && body.length) {
        console.log('\x1b[95m' + prependStr + ' Body:\x1b[0m');

        if (body.length > maxBodyLength) body = body.slice(0, maxBodyLength) + '\n...';
        console.log('\x1b[97m' + body.slice(0, maxBodyLength) + '\x1b[0m');
      } else if(isObj && Object.keys(body).length) {
        console.log('\x1b[95m' + prependStr + ' Body:\x1b[0m');

        var stringifiedObj = JSON.stringify(body, null, '\t');
        if (stringifiedObj.length > maxBodyLength) stringifiedObj = stringifiedObj.slice(0, maxBodyLength) + '\n...';
        stringifiedObj
          .split('\n') // split + loop needed for multi-line coloring
          .forEach(line => console.log('\x1b[97m' + line + '\x1b[0m'));
      }
    }

    if (logRequestBody) {
      app.use(function(req, res, next) { // log body if sent
        if (req.hasOwnProperty('body')) logBody('Request', req.body);
        next();
      });
    }

    if (logResponseBody) {
      // need to catch setting of response body
      var originalSend = app.response.send;
      app.response.send = function sendOverWrite(body) {
        originalSend.call(this, body);
        this.__morgan_body_response = body;
      };

      // allow mimicking node-restify server.on('after', fn) behavior
      app.use(function (req, res, next) {
        onFinished(res, logRes);
        next();
      });

      function logRes(err, res) {
        if (!err && res.hasOwnProperty('__morgan_body_response')) {
          logBody('Response', res.__morgan_body_response);
        }
      }
    }
  }

  // log response metadata (modified source to remove method and url)
  app.use(morgan('dev-res'));
};

// module.exports = morgan;
// module.exports.format = format;
// module.exports.token = token;

/**
 * Module dependencies.
 * @private
 */

var onFinished = require('on-finished');
var onHeaders = require('on-headers');

/**
 * Array of CLF month names.
 * @private
 */

var clfmonth = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Default log buffer duration.
 * @private
 */

var defaultBufferDuration = 1000;

/**
 * Create a logger middleware.
 *
 * @public
 * @param {String|Function} format
 * @param {Object} [options]
 * @return {Function} middleware
 */

function morgan(format, options) {
  var fmt = format;
  var opts = options || {};

  if (format && typeof format === 'object') {
    opts = format;
    fmt = opts.format || 'default';
  }

  // output on request instead of response
  var immediate = opts.immediate;

  // check if log entry should be skipped
  var skip = opts.skip || false;

  // format function
  var formatLine = typeof fmt !== 'function'
    ? getFormatFunction(fmt)
    : fmt;

  // stream
  var buffer = opts.buffer;
  var stream = opts.stream || process.stdout;

  // buffering support
  if (buffer) {

    // flush interval
    var interval = typeof buffer !== 'number'
      ? defaultBufferDuration
      : buffer;

    // swap the stream
    stream = createBufferStream(stream, interval);
  }

  return function logger(req, res, next) {
    // request data
    req._startAt = undefined;
    req._startTime = undefined;
    req._remoteAddress = getip(req);

    // response data
    res._startAt = undefined;
    res._startTime = undefined;

    // record request start
    recordStartTime.call(req);

    function logRequest() {
      if (skip !== false && skip(req, res)) {
        return;
      }

      var line = formatLine(morgan, req, res);

      if (null == line) {
        return;
      }

      stream.write(line + '\n');
    }

    if (immediate) {
      // immediate log
      logRequest();
    } else {
      // record response start
      onHeaders(res, recordStartTime);

      // log when response finished
      onFinished(res, logRequest);
    }

    next();
  };
}

/**
 * dev (colored)
 */

morgan.format('dev-res', function developmentFormatLine(tokens, req, res) {
  // get the status code if response written
  var status = res._header
    ? res.statusCode
    : undefined;

  // get status color
  var color = status >= 500 ? 31 // red
    : status >= 400 ? 33 // yellow
    : status >= 300 ? 36 // cyan
    : status >= 200 ? 32 // green
    : 0; // no color

  // get colored function
  var fn = developmentFormatLine[color];

  if (!fn) {
    // compile
    fn = developmentFormatLine[color] = compile('\x1b[96mResponse: \x1b['
      + color + 'm:status \x1b[0m:response-time ms - :res[content-length]\x1b[0m');
  }

  return fn(tokens, req, res);
});

/**
 * request url
 */

morgan.token('url', function getUrlToken(req) {
  return req.originalUrl || req.url;
});

/**
 * request method
 */

morgan.token('method', function getMethodToken(req) {
  return req.method;
});

/**
 * response time in milliseconds
 */

morgan.token('response-time', function getResponseTimeToken(req, res, digits) {
  if (!req._startAt || !res._startAt) {
    // missing request and/or response start time
    return;
  }

  // calculate diff
  var ms = (res._startAt[0] - req._startAt[0]) * 1e3
    + (res._startAt[1] - req._startAt[1]) * 1e-6;

  // return truncated value
  return ms.toFixed(digits === undefined ? 3 : digits);
});

/**
 * current date
 */

function formatTimezone(date, timezone) {
  // Takes a date object and formats it as:
  // Thu Oct 19 2017 12:35:19 GMT+0530 (IST)
  const tzDate = moment(date).tz(timezone);
  return `${tzDate.toString()} (${tzDate.format('z')})`;
}

function checkLocalTimezone(format) {
  // Checks if the format passed if of the form `local,<timezone>`
  // if yes returns the timezone, otherwise returns null
  const split = format.split(",");
  const prefix = split[0];
  const suffix = split.slice(1).join(",");
  if (prefix === "local")
    return suffix;
  else
    return null;
}

morgan.token('date', function getDateToken(req, res, format) {
  var date = new Date();

  switch (format) {
    case 'clf':
      return clfdate(date);
    case 'iso':
      return date.toISOString();
    default:
      const tz = checkLocalTimezone(format);
      if (tz)
        return formatTimezone(date, tz);
      else
        return date.toUTCString();
  }
});

/**
 * response status code
 */

morgan.token('status', function getStatusToken(req, res) {
  return res._header
    ? String(res.statusCode)
    : undefined;
});

/**
 * normalized referrer
 */

morgan.token('referrer', function getReferrerToken(req) {
  return req.headers.referer || req.headers.referrer;
});

/**
 * remote address
 */

morgan.token('remote-addr', getip);

/**
 * remote user
 */

/**
 * HTTP version
 */

morgan.token('http-version', function getHttpVersionToken(req) {
  return req.httpVersionMajor + '.' + req.httpVersionMinor;
});

/**
 * UA string
 */

morgan.token('user-agent', function getUserAgentToken(req) {
  return req.headers['user-agent'];
});

/**
 * request header
 */

morgan.token('req', function getRequestToken(req, res, field) {
  // get header
  var header = req.headers[field.toLowerCase()];

  return Array.isArray(header)
    ? header.join(', ')
    : header;
});

/**
 * response header
 */

morgan.token('res', function getResponseTime(req, res, field) {
  if (!res._header) return undefined;

  // get header
  var header = res.getHeader(field);

  return Array.isArray(header)
    ? header.join(', ')
    : header;
});

/**
 * Format a Date in the common log format.
 *
 * @private
 * @param {Date} dateTime
 * @return {string}
 */

function clfdate(dateTime) {
  var date = dateTime.getUTCDate();
  var hour = dateTime.getUTCHours();
  var mins = dateTime.getUTCMinutes();
  var secs = dateTime.getUTCSeconds();
  var year = dateTime.getUTCFullYear();

  var month = clfmonth[dateTime.getUTCMonth()];

  return pad2(date) + '/' + month + '/' + year
    + ':' + pad2(hour) + ':' + pad2(mins) + ':' + pad2(secs)
    + ' +0000';
}

/**
 * Compile a format string into a function.
 *
 * @param {string} format
 * @return {function}
 * @public
 */

function compile(format) {
  if (typeof format !== 'string') {
    throw new TypeError('argument format must be a string');
  }

  var fmt = format.replace(/"/g, '\\"');
  var js = '  return "' + fmt.replace(/:([-\w]{2,})(?:\[([^\]]+)\])?/g, function(_, name, arg) {
    return '"\n    + (tokens["' + name + '"](req, res, ' + String(JSON.stringify(arg)) + ') || "-") + "';
  }) + '";';

  return new Function('tokens, req, res', js);
}

/**
 * Create a basic buffering stream.
 *
 * @param {object} stream
 * @param {number} interval
 * @public
 */

function createBufferStream(stream, interval) {
  var buf = [];
  var timer = null;

  // flush function
  function flush() {
    timer = null;
    stream.write(buf.join(''));
    buf.length = 0;
  }

  // write function
  function write(str) {
    if (timer === null) {
      timer = setTimeout(flush, interval);
    }

    buf.push(str);
  }

  // return a minimal "stream"
  return { write: write };
}

/**
 * Define a format with the given name.
 *
 * @param {string} name
 * @param {string|function} fmt
 * @public
 */

function format(name, fmt) {
  morgan[name] = fmt;
  return this;
}

/**
 * Lookup and compile a named format function.
 *
 * @param {string} name
 * @return {function}
 * @public
 */

function getFormatFunction(name) {
  // lookup format
  var fmt = morgan[name] || name || morgan.default;

  // return compiled format
  return typeof fmt !== 'function'
    ? compile(fmt)
    : fmt;
}

/**
 * Get request IP address.
 *
 * @private
 * @param {IncomingMessage} req
 * @return {string}
 */

function getip(req) {
  return req.ip
    || req._remoteAddress
    || (req.connection && req.connection.remoteAddress)
    || undefined;
}

/**
 * Pad number to two digits.
 *
 * @private
 * @param {number} num
 * @return {string}
 */

function pad2(num) {
  var str = String(num);

  return (str.length === 1 ? '0' : '')
    + str;
}

/**
 * Record the start time.
 * @private
 */

function recordStartTime() {
  this._startAt = process.hrtime();
  this._startTime = new Date();
}

/**
 * Define a token function with the given name,
 * and callback fn(req, res).
 *
 * @param {string} name
 * @param {function} fn
 * @public
 */

function token(name, fn) {
  morgan[name] = fn;
  return this;
}
