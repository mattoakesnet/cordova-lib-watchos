/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

var platforms = require('../../src/cordova/platforms'),
    util = require('../../src/cordova/util'),
    path = require('path'),
    shell = require('shelljs'),
    fs = require('fs'),
    et = require('elementtree'),
    xmlHelpers = require('../../src/util/xml-helpers'),
    Q = require('q'),
    child_process = require('child_process'),
    config = require('../../src/cordova/config'),
    Parser = require('../../src/cordova/metadata/parser'),
    ConfigParser = require('../../src/configparser/ConfigParser'),
    CordovaError = require('../../src/CordovaError'),
    cordova = require('../../src/cordova/cordova'),
    HooksRunner = require('../../src/hooks/HooksRunner');

// Create a real config object before mocking out everything.
var cfg = new ConfigParser(path.join(__dirname, '..', 'test-config.xml'));

describe('wp8 project parser', function() {
    var proj = '/some/path';
    var exists, exec, custom, readdir, cfg_parser, config_read;
    var manifestXml, projXml;
    beforeEach(function() {
        exists = spyOn(fs, 'existsSync').andReturn(true);
        exec = spyOn(child_process, 'exec').andCallFake(function(cmd, opts, cb) {
            (cb || opts)(0, '', '');
        });
        custom = spyOn(config, 'has_custom_path').andReturn(false);
        config_read = spyOn(config, 'read').andCallFake(function() {
            return custom() ? {
                lib: {
                    wp8: {
                        url: custom()
                    }
                }
            }
            : ({})
        });
        readdir = spyOn(fs, 'readdirSync').andReturn(['test.csproj']);
        projXml = manifestXml = null;
        spyOn(xmlHelpers, 'parseElementtreeSync').andCallFake(function(path) {
            if (/WMAppManifest.xml$/.exec(path)) {
                return manifestXml = new et.ElementTree(et.XML('<foo><App Title="s"><PrimaryToken /><RootNamespace/><SilverlightAppEntry/><XapFilename/><AssemblyName/></App></foo>'));
            } else if (/csproj$/.exec(path)) {
                return projXml = new et.ElementTree(et.XML('<foo><App Title="s"><PrimaryToken /><RootNamespace/><SilverlightAppEntry/><XapFilename/><AssemblyName/></App></foo>'));
            } else if (/xaml$/.exec(path)) {
                return new et.ElementTree(et.XML('<foo><App Title="s"><PrimaryToken /><RootNamespace/><SilverlightAppEntry/><XapFilename/><AssemblyName/></App></foo>'));
            } else {
                throw new CordovaError('Unexpected parseElementtreeSync: ' + path);
            }
        });
    });

    function wrapper(p, done, post) {
        p.then(post, function(err) {
            expect(err).toBeUndefined();
        }).fin(done);
    }

    function errorWrapper(p, done, post) {
        p.then(function() {
            expect('this call').toBe('fail');
        }, post).fin(done);
    }

    describe('constructions', function() {
        it('should throw if provided directory does not contain a csproj file', function() {
            readdir.andReturn([]);
            expect(function() {
                new platforms.wp8.parser(proj);
            }).toThrow();
        });
        it('should create an instance with path, manifest properties', function() {
            expect(function() {
                var p = new platforms.wp8.parser(proj);
                expect(p.wp8_proj_dir).toEqual(proj);
                expect(p.manifest_path).toEqual(path.join(proj, 'Properties', 'WMAppManifest.xml'));
            }).not.toThrow();
        });
        it('should be an instance of Parser', function() {
            expect(new platforms.wp8.parser(proj) instanceof Parser).toBeTruthy();
        });
    });

    describe('instance', function() {
        var p, cp, rm, is_cordova, write, read, mv, mkdir;
        var wp8_proj = path.join(proj, 'platforms', 'wp8');
        beforeEach(function() {
            p = new platforms.wp8.parser(wp8_proj);
            cp = spyOn(shell, 'cp');
            rm = spyOn(shell, 'rm');
            mv = spyOn(shell, 'mv');
            mkdir = spyOn(shell, 'mkdir');
            is_cordova = spyOn(util, 'isCordova').andReturn(proj);
            write = spyOn(fs, 'writeFileSync');
            read = spyOn(fs, 'readFileSync').andReturn('');
        });

        describe('update_from_config method', function() {
            beforeEach(function() {
                cfg.name = function() { return 'testname' };
                cfg.content = function() { return 'index.html' };
                cfg.packageName = function() { return 'testpkg' };
                cfg.version = function() { return 'one point oh' };
                readdir.andReturn(['test.sln']);
            });

            it('should write out the app name to wmappmanifest.xml', function() {
                p.update_from_config(cfg);
                var appEl = manifestXml.getroot().find('.//App');
                expect(appEl.attrib.Title).toEqual('testname');
            });
            it('should write out the app id to csproj file', function() {
                p.update_from_config(cfg);
                var appEl = projXml.getroot().find('.//RootNamespace');
                expect(appEl.text).toContain('testpkg');
            });
            it('should write out the app version to wmappmanifest.xml', function() {
                p.update_from_config(cfg);
                var appEl = manifestXml.getroot().find('.//App');
                expect(appEl.attrib.Version).toEqual('one point oh');
            });
        });
        describe('www_dir method', function() {
            it('should return www', function() {
                expect(p.www_dir()).toEqual(path.join(wp8_proj, 'www'));
            });
        });
        describe('config_xml method', function() {
            it('should return the location of the config.xml', function() {
                expect(p.config_xml()).toEqual(path.join(wp8_proj, 'config.xml'));
            });
        });
        describe('update_www method', function() {
            var update_project;
            beforeEach(function() {
                update_project = spyOn(p, 'update_project');
            });
            it('should rm project-level www and cp in platform agnostic www', function() {
                p.update_www();
                expect(rm).toHaveBeenCalled();
                expect(cp).toHaveBeenCalled();
            });
        });
        describe('update_project method', function() {
            var config, www, overrides, svn, fire;
            beforeEach(function() {
                config = spyOn(p, 'update_from_config');
                www = spyOn(p, 'update_www');
                svn = spyOn(util, 'deleteSvnFolders');
                exists.andReturn(false);
                fire = spyOn(HooksRunner.prototype, 'fire').andReturn(Q());
            });
            it('should call update_from_config', function(done) {
                wrapper(p.update_project(), done, function() {
                    expect(config).toHaveBeenCalled();
                });
            });
            it('should throw if update_from_config throws', function(done) {
                var err = new Error('uh oh!');
                config.andCallFake(function() { throw err; });
                errorWrapper(p.update_project({}), done, function(e) {
                    expect(e).toEqual(err);
                });
            });
            it('should not call update_www', function(done) {
                wrapper(p.update_project(), done, function() {
                    expect(www).not.toHaveBeenCalled();
                });
            });
            it('should call deleteSvnFolders', function(done) {
                wrapper(p.update_project(), done, function() {
                    expect(svn).toHaveBeenCalled();
                });
            });
        });
    });
});
