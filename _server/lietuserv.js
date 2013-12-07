/*
 *
 * Basic Node.js HTTP server, with some sane performance optimizations.
 *
 * Uses Connect to start a HTTP server, static middleware to serve
 * static content from the Jekyll-generated _site directory. Also
 * adds gzip compression and 404 page support. Possibly later E-Tags.
 *
 * Created by Janne Enberg.
 */

// Load requirements
var zlib = require('zlib');
var http = require('http');
var fs = require('fs');
var mime = require('mime');

// Load config
var config = require('./config.js');

var log = function() {
	if (!config.debug) return;

	console.log(arguments);
};


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var serveUrl, serveFile, sendResponse, redirect;

/**
 * Get an RFC 2822 -compatible date for Last-Modified
 */
var getRFC2822Date = function(d) {

	// If no date given, create a new one
	d = d || new Date();

	// Return the formatted string:
	// Tue, 15 Nov 1994 12:45:26 GMT
	return [
		days[ d.getUTCDay() ] + ',',

		d.getUTCDate() < 10 ? '0' : '' + d.getUTCDate(),

		months[d.getUTCMonth()],

		d.getUTCFullYear(),

		// HH:MM:SS
		(
			(d.getUTCHours() < 10 ? '0' : '') + d.getUTCHours()
				+ ':' +
			(d.getUTCMinutes() < 10 ? '0' : '') + d.getUTCMinutes()
				+ ':' +
			(d.getUTCSeconds() < 10 ? '0' : '') + d.getUTCSeconds()
		)
		,
		'GMT'
	].join(' ');
};

/**
 * Formats "accept-encoding" to "Accept-Encoding" for better readability
 */
var formatHeader = function(header) {
	var parts = header.split('-');

	for (var i = 0, count = parts.length; i < count; ++i) {
		parts[i] = parts[i].substr(0, 1).toUpperCase() + parts[i].substr(1);
	}

	return parts.join('-');
};

/**
 * Log errors in a useful enough manner
 */
var handleError = function(err, request) {
	if (request) {
		console.error('Request from ' + request.socket.remoteAddress + ' caught an exception!');
		console.error(request.method + ' ' + request.url + ' HTTP/' + request.httpVersion);

		for (var header in request.headers) {
			console.error(formatHeader(header) + ': ' + request.headers[header]);
		}
		console.error();
	}
	console.error('The error was: ' + err);
	console.error();
	console.trace();
	process.exit(1);
};


/**
 * Handle passing responses, with optional gzip encoding
 */
sendResponse = function(request, response, status, headers, responseContent) {

	// Determine if we can use gzip compression for this request
	var useGzip = false;
	headers['Vary'] = 'Accept-Encoding';
	if (responseContent !== undefined && request.headers['accept-encoding'] && headers['Content-Type'] && headers['Content-Type'].match(config.gzipMime)) {
		if (request.headers['accept-encoding'].match(/deflate/)) {
			log('Using deflate encoding');
			useGzip = 'deflate';
		} else if (request.headers['accept-encoding'].match(/gzip/)) {
			log('Using gzip encoding');
			useGzip = 'gzip';
		}
	}

	// Function to finally write the headers and content to the response
	var send = function(err, content) {
		if (err) handleError(err, request);

		// Add content-length, Flash seems to require this
		headers['Content-Length'] = content.length;

		log('Sending headers', headers);
		response.writeHead(status, headers);

		if (content) {
			log('Sending ' + content.length + ' bytes as response');
			response.write(content);
		}

		response.end();
	};

	// Add caching headers if it looks like it'll be fine to do so
	if (200 === status || 404 === status) {
		log('Adding caching headers for ' + status + ' response');
		headers['Cache-Control'] = 'public, max-age=' + (config.maxAge / 1000) ;
	}

	// If we want to gzip, do it
	if (useGzip) {
		log('Compressing output...');
		headers['Content-Encoding'] = useGzip;
		zlib[useGzip](responseContent, send);

	// If not, just send
	} else {
		log('Sending response without compressing...');
		send(false, responseContent);
	}
};

redirect = function(request, response, uri, status) {
	var headers = {};
	headers['Location'] = uri;
	sendResponse(request, response, status, headers, '');
};

// Serve a static file
serveFile = function(request, response, status, filePath, url) {
	log('Serving file ' + filePath + ' with status ' + status);

	// Build some headers
	var headers = {
		'Content-Type': mime.lookup(filePath)
	};

	if (headers['Content-Type'].match(/text|javascript|json/)) {
		headers['Content-Type'] += '; charset=UTF-8';
	}

	log('Content-Type: ' + headers['Content-Type']);

	// Do a stat() on the file to figure out modified time
	fs.stat(filePath, function(err, statData) {
		if (err) handleError(err, request);

		if (statData.isDirectory()) {
			log('Whoops, ' + filePath + ' looks like a directory.');
			redirect(request, response, url + '/', 301);
			return;
		}

		headers['Last-Modified'] = getRFC2822Date(statData.mtime);

		if (request.headers['if-modified-since']) {
			if (new Date(request.headers['if-modified-since']) >= statData.mtime) {
				log('If-Modified-Since ' + request.headers['if-modified-since'] + ' -> 304');
				// Not modified since the requested time, return 304
				response.statusCode = 304;
				response.end();
				return;
			}
		}

		log('Reading file...');
		// Read the file
		fs.readFile(filePath, function(err, data) {
			if (err) handleError(err, request);

			// Create an E-Tag
			headers['ETag'] = statData.size + '-' + Date.parse(statData.mtime);
			log('Created ETag ' + headers['ETag']);

			// Check for ETag matches
			if (request.headers['if-none-match'] && request.headers['if-none-match'] === headers['ETag']) {
				response.statusCode = 304;
				response.end();
				return;
			}

			sendResponse(request, response, status, headers, data);
			return;
		});
	});
};


// Path to 404 -file
var file404 = config.basePath + '/404.html';

// fs.realpath() -cache
var realPathCache = {};

serveUrl = function(request, response, url) {

	// Folders -> index.html
	if (url.substr(-1) === '/') {
		url += 'index.html';
	}

	// Figure out the requested file
	var requestPath = config.basePath + url;

	// Check that the path isn't an evil one
	fs.realpath(requestPath, realPathCache, function(err, resolvedPath) {
		var status = 200;
		if (err) {
			if (err.errno === 34) {
				log('File not found -> 404');
				resolvedPath = file404;
				status = 404;
			} else {
				handleError(err, request);
			}
		}

		// If trying to break out of the security path, just show 404
		if (resolvedPath.substr(0, config.securityRoot.length) !== config.securityRoot) {
			log(config.basePath, resolvedPath);
			log('Trying to break out of basepath -> 404');
			resolvedPath = file404;
			status = 404;
		}

		// Show whatever file we're going to show now
		serveFile(request, response, status, resolvedPath, url);

	});

};

http.createServer(function(request, response) {
	log('New request for ' + request.url);

	serveUrl(request, response, request.url);
}).listen(config.port);


console.log('Listening on port ' + config.port);
