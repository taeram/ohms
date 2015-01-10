var express = require('express');
var sys = require('sys');
var exec = require('child_process').exec;
var http = require('http');
var path = require('path');
var twilio = require('twilio');
var _ = require('underscore');
var fs = require('fs');
var bodyParser = require('body-parser');
var morgan = require('morgan');

var app = express();
var appPort = 3000;
var MAX_SMS_LENGTH = 160; // As defined by Twilio: http://www.twilio.com/docs/errors/21605
var MAX_SEARCH_RESULTS = 10;

var twilioFromNumber= process.env.FROM_NUMBER;
var myMobileNumber = process.env.CONTROL_NUMBER;
var twilioClient = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
var historyFile = "history.json";
var commandIndexFile = "index.json";
var debug = process.env.DEBUG || false;

var couchPotatoApi = {
    host: 'localhost',
    port: 5050,
    path: '/couchpotato/api/' + process.env.COUCHPOTATO_API_KEY + '/',
    method: 'GET'
};

var sickbeardApi = {
    host: 'localhost',
    port: 8081,
    path: '/sickbeard/api/' + process.env.SICKBEARD_API_KEY + '/',
};

app.disable('x-powered-by');
app.use(morgan('combined'));
app.use(bodyParser.urlencoded());

// Handle the request
app.post('/', function(req, res) {
    // Make sure the request came from Twilio
    if (!debug && twilio.validateExpressRequest(req, process.env.TWILIO_AUTH_TOKEN) === false) {
        console.log("Request not from Twilio");
        return res.status(403).send({status: 'forbidden'});
    }

    // Make sure the request came from my number
    if (!debug && req.body.From.trim() != myMobileNumber) {
        console.log("Request not from " + myMobileNumber);
        return res.status(403).send({status: 'forbidden'});
    }

    // Trim the request string
    req.body.Body = req.body.Body.trim();

    // Store the request in the history
    add_history({
        "date": new Date(),
        "request": req.body.Body
    });

    var application = null;
    var action = null;
    var extra = null;
    if (req.body.Body) {
        if (!req.body.Body.match(/ /)) {
            application = req.body.Body.toLowerCase();
        } else {
            var routes = req.body.Body.split(" ");

            application = routes[0].toLowerCase();
            if (routes.length > 0) {
                action = routes[1].toLowerCase();
                if (routes.length > 1) {
                    extra = _.rest(routes, 2).join(" ")
                }
            }
        }
    }

    // Expand shortcuts
    if (application == 'm' || application == 'movie') {
        application = 'couchpotato';
    } else if (application == 't' || application == 'tv') {
        application = 'sickbeard';
    }

    console.log("Got request", application, action);

    var response;
    if (application == "status") {
        exec('uptime', function callback(error, stdout, stderr) {
            send_sms(stdout);
        });
    } else if (application == "couchpotato") {
        if (action == "search") {
            response = couchpotato_search(extra);
        } else if (action == "add") {
            response = couchpotato_add(extra);
        } else {
            response = application + ': unknown action';
        }
    } else if (application == "sickbeard") {
        if (action == "search") {
            response = sickbeard_search(extra);
        } else if (action == "add") {
            response = sickbeard_add(extra);
        } else {
            response = application + ': unknown action';
        }
    } else {
        response = "Unknown application: " + application;
    }

    if (response === null) {
        response = "Error processing request: " + req.body.Body;
    }

    // Respond to the user with a message
    var twResp = new twilio.TwimlResponse();
    twResp.sms(response);

    res.type('text/xml');
    return res.send(twResp.toString());
});


/**
 * Get the next command index
 *
 * @return integer
 */
var maxCommandIndex = 20;
function get_next_command_index() {
    var commandIndex = 0;
    if (fs.existsSync(commandIndexFile)) {
        commandIndex = parseInt(fs.readFileSync(commandIndexFile));
    }
    commandIndex++;

    // Rollover to keep the indexes short
    if (commandIndex > maxCommandIndex) {
        commandIndex = 1;
    }

    fs.writeFileSync(commandIndexFile, commandIndex);

    return commandIndex;
}

/**
 * Get the history
 *
 * @return array
 */
function get_history() {
    var history = [];
    if (fs.existsSync(historyFile)) {
        try {
            history = JSON.parse(fs.readFileSync(historyFile));
        } catch (e) {
            console.log("Could not parse " + historyFile);
        }
    }

    if (!_.isArray(history)) {
        history = [];
    }

    return history;
}

/**
 * Add an entry to the history
 *
 * @param object entry The history entry to add
 */
var maxHistoryIndex = 60;
function add_history(entry) {
    var history = get_history();
    history.push(entry);

    // Trim any old history
    if (history.length > maxHistoryIndex) {
        history.shift();
    }

    fs.writeFileSync(historyFile, JSON.stringify(history, null, 4));
}

/**
 * Add a movie to the wanted list
 *
 * @param  string movie_name The movie name
 *
 * @return string
 */
function couchpotato_search(movie_name) {
    if (_.isEmpty(movie_name)) {
        return 'Usage: couchpotato search [name of movie]';
    }

    var options = _.clone(couchPotatoApi);
    options.path += "movie.search/?q=" + encodeURIComponent(movie_name);

    http_get(options,
        function (result) {
            if (result.success === true && result.movies !== undefined) {
                var searchResults = [];
                for (i=0; i < result.movies.length && i < MAX_SEARCH_RESULTS; i++) {
                    var movie = result.movies[i];
                    var movieTitle = movie.original_title + " (" + movie.year + ")";

                    if (movie.in_library !== false) {
                        queue_sms(movieTitle + ' is already in your library');
                    } else if (movie.in_wanted !== false) {
                        queue_sms(movieTitle + ' is already in your wanted list');
                    } else {
                        var commandId = get_next_command_index();
                        add_history({
                            "command_id": commandId,
                            "app": "couchpotato",
                            "imdb": movie.imdb,
                            "title": movieTitle
                        });

                        queue_sms(commandId + ". " + movieTitle);
                    }
                }

                send_sms_queue();
            } else {
                send_sms('No matches found for ' + movie_name);
            }
        },
        function(e) {
            var errorMessage = "couchpotato_search error: " + e.message;
            console.log(e.message);
            send_sms(errorMessage);
        }
    );
}

/**
 * Add a movie to couch potato
 *
 * @param string command_id The command id for the movie
 */
function couchpotato_add(command_id) {
    if (_.isEmpty(command_id)) {
        throw "Invalid command id";
    }

    var history = get_history().reverse();
    var movie = _.find(history, function (item) {
        if (item['app'] == "couchpotato" && item['command_id'] == command_id) {
            return true;
        }
    });

    if (!movie) {
        return send_sms('Invalid selection: ' + command_id);
    }

    imdb_id = movie['imdb'].trim();
    var options = _.clone(couchPotatoApi);
    options.path += "movie.add/?identifier=" + imdb_id;

    http_get(options,
        function (result) {
            if (result.success === true)  {
                send_sms(movie['title'] + ' added to wanted list');
            } else {
                send_sms('Could not add ' + movie['title'] + ' to wanted list');
            }
        },
        function(e) {
            var errorMessage = "couchpotato_add error: " + e.message;
            console.log(e.message);
            send_sms(errorMessage);
        }
    );
}

/**
 * Add a tv show to sickbeard
 *
 * @param  string show_name The tv show name
 *
 * @return string
 */
function sickbeard_search(show_name) {
    if (_.isEmpty(show_name)) {
        throw "Invalid show name";
    }

    var options = _.clone(sickbeardApi);
    options.path += "?cmd=sb.searchtvdb&lang=en&name=" + encodeURIComponent(show_name);

    http_get(options,
        function (result) {
            if (result.result == 'success') {
                if (result.data.results.length === 0) {
                    send_sms('No matches found for ' + show_name);
                    return;
                }

                for (i=0; i < result.data.results.length && i < MAX_SEARCH_RESULTS; i++) {
                    var show = result.data.results[i];
                    if (show.first_aired !== null) {
                        show.year = show.first_aired.replace(/-.*$/, '');
                    } else {
                        show.year = null;
                    }
                    var showTitle = show.name + " (" + show.year + ")";

                    var commandId = get_next_command_index();
                    add_history({
                        "command_id": commandId,
                        "app": "sickbeard",
                        "tvdbid": show.tvdbid,
                        "title": showTitle
                    });

                    queue_sms(commandId + ". " + showTitle);
                }

                send_sms_queue();
            } else {
                send_sms('Could not add ' + show_name + ': ' + result.message);
            }
        },
        function(e) {
            var errorMessage = "sickbeard_search error: " + e.message;
            console.log(e.message);
            send_sms(errorMessage);
        }
    );
}

/**
 * Add a tv show to sickbeard
 *
 * @param string tvdb_id The tvdb id for the tv show
 */
function sickbeard_add(command_id) {
    if (_.isEmpty(command_id)) {
        throw "Invalid command id";
    }

    var history = get_history().reverse();
    var show = _.find(history, function (item) {
        if (item['app'] == "sickbeard" && item['command_id'] == command_id) {
            return true;
        }
    });

    if (!show) {
        return send_sms('Invalid selection: ' + command_id);
    }

    var tvdb_id = show['tvdbid'];
    var options = _.clone(sickbeardApi);
    options.path += "?cmd=show.addnew&tvdbid=" + tvdb_id;

    http_get(options,
        function (result) {
            if (result.result == 'success') {
                send_sms(show['title'] + ' added!');
            } else {
                send_sms('Could not add ' + show['title'] + ': ' + result.message);
            }
        },
        function(e) {
            var errorMessage = "sickbeard_add error: " + e.message;
            console.log(e.message);
            send_sms(errorMessage);
        }
    );
}

/**
 * Make a HTTP GET request
 *
 * @param object options The url parameters
 * @param function callback_success Call this function on success
 * @param function callback_error call this function on error
 */
function http_get(options, callback_success, callback_error) {
    http.get(options, function (http_res) {
        var data = "";

        http_res.on("data", function (chunk) {
            data += chunk;
        });

        http_res.on("end", function () {
            result = JSON.parse(data);
            callback_success(result);
        });
    }).on('error', callback_error);
}

/**
 * Send an SMS message
 *
 * @param  string body The SMS body
 */
function send_sms(body) {
    var options = {
        to: myMobileNumber,
        from: twilioFromNumber,
        body: body.trim()
    };

    console.log("Sending SMS", JSON.stringify(options));

    if (!debug) {
        twilioClient.sms.messages.create(options, function(error, responseData) {
            if (error) {
                console.log(responseData);
            }
        });
    }
}

/**
 * Add an SMS message to the queue
 *
 * @param string message The message to send
 */
var sms_queue = [];
function queue_sms(message) {
    if (message.length > MAX_SMS_LENGTH) {
        console.log("Not adding message to queue, message is too long: " + message);
        return;
    }

    sms_queue.push(message);
}

/**
 * Send all queued SMS messages
 *
 * Bundle the SMS messages up so we send as many lines as possible per message
 */
function send_sms_queue() {
    if (sms_queue.length > 0) {
        var messageBuffer = '';
        for (var i in sms_queue) {
            if (sms_queue[i].length > MAX_SMS_LENGTH) {
                console.log("Not sending message from queue, message is too long: " + sms_queue[i]);
                continue;
            }

            if ((messageBuffer + sms_queue[i] + 1).length > MAX_SMS_LENGTH) {
                send_sms(messageBuffer);
                messageBuffer = '';
            } else {
                messageBuffer += sms_queue[i] + "\n";
            }
        }

        messageBuffer = messageBuffer.trim();
        if (messageBuffer.length > 0) {
            send_sms(messageBuffer);
        }
    } else {
        console.log("SMS queue empty, not sending anything");
    }

    sms_queue = [];
}

// Start the show!
app.listen(appPort);
console.log('Listening on port ' + appPort + '...');
