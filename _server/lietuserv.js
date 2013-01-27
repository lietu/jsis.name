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

/**
 * Handle passing responses, with optional gzip encoding
 */
var sendResponse = function(request, response, status, headers, responseContent) {

	// Determine if we can use gzip compression for this request
	var useGzip = false;
	headers['Vary'] = 'Accept-Encoding';
	if (responseContent !== undefined && request.headers['accept-encoding'] && headers['Content-Type'].match(config.gzipMime)) {
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
		if (err) throw err;

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
		headers['Cache-Control'] = 'public, max-age=' + config.maxAge;
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

// Serve a static file
var serveFile = function(request, response, status, filePath) {
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
		if (err) throw err;

		headers['Last-Modified'] = String(statData.mtime);

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
			if (err) throw err;

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
http.createServer(function(request, response) {
	// Folders -> index.html
	if (request.url.substr(-1) === '/') {
		request.url += 'index.html';
	}

	// Figure out the requested file
	var requestPath = config.basePath + request.url;

	log('New request for ' + request.url);

	// Check that the path isn't an evil one
	fs.realpath(requestPath, realPathCache, function(err, resolvedPath) {
		var status = 200;
		if (err) {
			if (err.errno === 34) {
				log('File not found -> 404');
				resolvedPath = file404;
				status = 404;
			} else {
				throw err;
			}
		}

		// If trying to break out of the basepath, just show 404
		if (resolvedPath.substr(0, config.basePath.length) !== config.basePath) {
			log(config.basePath, resolvedPath);
			log('Trying to break out of basepath -> 404');
			resolvedPath = file404;
			status = 404;
		}

		// Show whatever file we're going to show now
		serveFile(request, response, status, resolvedPath);

	});

}).listen(config.port);


console.log('Listening on port ' + config.port);

