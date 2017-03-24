#!/usr/bin/env node

'use strict';

const program = require('commander-plus');
const colors = require('colors');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const _ = require('underscore');
const firebase = require('firebase-tools');
const rp = require('request-promise-native');

const cwd = process.cwd();

var App = {
    config: null,
    env: null,
    loginData: null
};

program
    .version('0.0.1')
    .command('init')
    .option('-p, --project', 'project folder')
    .option('-c, --config', 'config file')
    .option('-e, --env', 'env to do')
    .action((p, c, e) => {
        configureApp(p, c, e);
    });
program.parse(process.argv);

function runCommand(cmd, args, wd) {

    return new Promise((resolve, reject) => {

        // /usr/local/lib/node_modules/npm/bin/node-gyp-bin:
        // /Users/alex/Documents/Code/GitHub/DeviceCloud/hosting/node_modules/.bin:
        // /usr/local/bin:/usr/bin:/bin:/usr/sbin:
        // /sbin

        // add to path here
        var path = '/usr/local/lib/node_modules/npm/bin/node-gyp-bin:' + process.env.PATH;
        path += ':' + (wd ? (wd + '/node_modules/.bin') : (process.cwd() + '/node_modules/.bin'));
        path += ':/sbin';

        process.env.PATH = path;

        var opt = { env: process.env };
        if (wd) {
            opt['cwd'] = wd;
        }
        const p = spawn(cmd, args, opt);
        let results = [];
        let resultData = '';
        let errors = [];
        let errorData = '';



        p.stdout.on('data', data => {
            resultData += data.toString();
            if (resultData[resultData.length - 1] == '\n') {
                resultData = resultData.slice(0, resultData.length - 1);
                results.push(resultData);
                resultData = '';
            }
        });

        p.stderr.on('data', data => {
            errorData += data.toString();
            if (errorData[errorData.length - 1] == '\n') {
                errorData.slice(0, errorData.length - 1);
                errors.push(errorData);
                errorData = '';
            }
        });

        p.on('error', err => {
            errors.push(err.message);
        });

        p.on('close', code => {
            if (code == 0) {
                resolve({
                    results: results,
                    errors: errors,
                    code: code
                });
            } else {
                reject({
                    results: results,
                    errors: errors,
                    code: code
                });
            }
        });

    });
}

function pathIsDirectory(sourcePath) {
    var file = null;
    try {
        file = sourcePath[0] == '~' ? path.join(process.env.HOME, sourcePath.slice(1)) : sourcePath;
        file = path.resolve(file);
        var stats = fs.statSync(file);
        return stats.isDirectory();
    } catch (error) {
        console.error('[pathIsDirectory] ' + error.message);
    }
    return false;
}

function pathIsFile(sourcePath) {
    var file = null;
    try {
        file = sourcePath[0] == '~' ? path.join(process.env.HOME, sourcePath.slice(1)) : sourcePath;
        file = path.resolve(file);
        var stats = fs.statSync(file);
        return stats.isFile();
    } catch (error) {
        console.error('[pathIsFile] ' + error.message);
    }
    return false;
}

function pathFromSourcePath(sourcePath) {
    var file = null;
    try {
        file = sourcePath[0] == '~' ? path.join(process.env.HOME, sourcePath.slice(1)) : sourcePath;
        file = path.resolve(file);
        var stats = fs.statSync(file);
        return stats.isFile() || stats.isDirectory() ? file : null;
    } catch (error) {
        console.error('[pathFromSourcePath] ' + error.message);
    }
    return null;
}

function prompt(text) {
    return new Promise((resolve, reject) => {
        program.prompt(text, (output) => {
            resolve(output);
        });
    });
}

function ParseConfig(xcloudConfig) {

    xcloudConfig.database = "https://" + xcloudConfig.project_id + ".firebaseio.com";
    xcloudConfig.bucket = xcloudConfig.project_id + ".appspot.com";

    const config = {
        xcloud: xcloudConfig
    };

    var confs = [];
    function MakeConfs(conf) {
        var obj = [];
        Object.keys(conf).forEach(key => {
            if (key != 'init_data') {
                var inner = conf[key];
                if (_.isString(inner)) {
                    obj.push(`${key}=${inner}`);
                } else {
                    var all = MakeConfs(inner);
                    all.forEach(s => {
                        obj.push(`${key}.${s}`);
                    });
                }
            }
        });
        return obj;
    }
    return MakeConfs(config);
}

function configureApp(p, c, e) {

    App.env = _.isString(e) ? e : null;
    /*
    firebase.functions.config.get('xcloud',{
        project: 'function-test-e9661',
        token: t
    })
    .then( data => {
        console.log(data);
    })
    .catch( err => {
        console.log(err);
    });
    return;
    */
    /*
    firebase.list({
        token: t
    })
    .then( data => {
        console.log(data);
    })
    .catch( err => {
        console.log(err);
    });
    return;
    */

    Promise.resolve()

        // get the directory of the project]
        .then(() => {
            return _.isString(p) ? p : prompt("Enter the path to your project folder: ");
        })
        .then(folder => {

            var dir = pathFromSourcePath(folder);
            if (!dir || !pathIsDirectory(dir)) {
                throw new Error('Project folder is not a directory');
            }

            App.projectDir = dir;
            return dir;
        })
        .then((dir) => {
            process.chdir(dir);
            return null;
        })

        // load login data
        .then(() => {

            try {
                App.loginData = require(App.projectDir + '/.xcloud.json');
            } catch (error) {
            }

            if (App.loginData) {
                var expiryDate = Number(App.loginData.tokens.expires_at);
                var now = Date.now();
                var expiresIn = expiryDate - now;
                if (expiresIn > 300000 /* 5 minutes */) {
                    return Promise.resolve();
                }
            }

            // login
            return firebase.login.ci({ interactive: true, localhost: true })
                .then(data => {
                    App.loginData = data;
                    return null;
                })
                .then(() => {
                    // save the login data
                    return new Promise((resolve, reject) => {
                        fs.writeFile(App.projectDir + '/.xcloud.json', JSON.stringify(App.loginData, null, 2), (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(null);
                            }
                        });
                    });
                });
        })

        // get the path to the config file
        .then(() => {
            return _.isString(c) ? c : prompt("Enter the path to your xcloud config file: ");
        })
        .then(file => {

            var configFile = pathFromSourcePath(file);
            if (!configFile || !pathIsFile(configFile)) {
                throw new Error("Can't find the xcloud file");
            }

            App.configFile = configFile;
            return configFile;
        })

        // load up the config
        .then(configFile => {
            try {
                var wd = process.cwd();
                App.config = require(configFile);
            } catch (error) {
                return error;
            }
            return App.config;
        })

        // upload the config to firebase
        .then(confData => {

            console.log('[TASK] Setting up configs...');

            var promises = [];
            Object.keys(confData).forEach(configKey => {

                if (!App.env || configKey === App.env) {

                    var config = confData[configKey];
                    config.env = configKey;
                    var configLines = ParseConfig(config);

                    var funcData = Object.assign({}, {
                        project: config.project_id,
                        token: App.loginData.tokens.refresh_token
                    });

                    var p = Promise.resolve()
                        .then(() => {

                            // unset all config keys
                            return firebase.functions.config.get(undefined, {
                                project: config.project_id,
                                token: App.loginData.tokens.refresh_token
                            })
                                .then(data => {
                                    var keys = Object.keys(data).join(',');
                                    if (keys.length > 0) {
                                        return firebase.functions.config.unset([keys], {
                                            project: config.project_id,
                                            token: App.loginData.tokens.refresh_token
                                        });
                                    }
                                    return null;
                                });

                        })
                        .then(() => {

                            console.log(`[CONFIG] building hosting for ${config.project_id}:${configKey}...`);

                            // remove old build files
                            try {
                                fs.unlinkSync(App.projectDir + '/hosting/public/bundle.js');
                            } catch (error) {
                            }

                            try {
                                fs.unlinkSync(App.projectDir + '/hosting/public/bundle.js.map');
                            } catch (error) {
                            }

                            try {
                                fs.unlinkSync(App.projectDir + '/hosting/public/index.html');
                            } catch (error) {
                            }

                            // build hosting
                            // 1. build webpack
                            // -p
                            var args = [
                                '--env.frontend=' + configKey,
                                '-p'
                            ];
                            return runCommand(App.projectDir + '/hosting/node_modules/.bin/webpack', args, App.projectDir + '/hosting')

                        })
                        .then(() => {

                            // create config for the project
                            console.log(`[CONFIG] creating config for ${config.project_id}:${configKey}...`);
                            return runCommand('firebase', [
                                'functions:config:set',
                                '--project',
                                config.project_id,
                                '--token',
                                App.loginData.tokens.refresh_token
                            ].concat(configLines));
                        })
                        .then(() => {

                            // deploy functions
                            console.log(`[CONFIG] deploying functions and config for ${config.project_id}:${configKey}...`);
                            return runCommand('firebase', [
                                'deploy',
                                '--project',
                                config.project_id,
                                '--token',
                                App.loginData.tokens.refresh_token,
                                '--only',
                                'functions'
                            ]);
                        })
                        .then(() => {

                            // deploy hosting
                            console.log(`[CONFIG] deploying hosting for ${config.project_id}:${configKey}...`);
                            return runCommand('firebase', [
                                'deploy',
                                '--project',
                                config.project_id,
                                '--token',
                                App.loginData.tokens.refresh_token,
                                '--only',
                                'hosting'
                            ]);
                        })
                        .then(() => {

                            // deploy database
                            console.log(`[CONFIG] deploying database rules for ${config.project_id}:${configKey}...`);
                            return runCommand('firebase', [
                                'deploy',
                                '--project',
                                config.project_id,
                                '--token',
                                App.loginData.tokens.refresh_token,
                                '--only',
                                'database'
                            ]);
                        })
                        .then(() => {

                            console.log(`[CONFIG] initializing data for ${config.project_id}:${configKey}...`);

                            // init data
                            var options = {
                                method: 'POST',
                                uri: 'https://us-central1-' + config.project_id + '.cloudfunctions.net/api/1/_init',
                                body: config.init_data,
                                json: true // Automatically stringifies the body to JSON 
                            };

                            return rp(options)
                                .then(body => {
                                    return null;
                                })
                                .catch( err => {
                                    throw err;
                                });

                        });

                    promises.push(p);

                }

            });

            return Promise.all(promises);
            //return runCommand( 'firebase', ['functions:config:set'].concat(configLines) );
        })

        // completed
        .then(() => {
            console.log('Task completed'.green);
            process.exit(0);
        })
        .catch(err => {

            console.error('[ERROR]'.red + ' ' + err.message);
            process.exit(1);

        });

};