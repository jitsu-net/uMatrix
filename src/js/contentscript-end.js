/*******************************************************************************

    µMatrix - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014  Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

/* global vAPI */
/* jshint multistr: true, boss: true */

/******************************************************************************/
/******************************************************************************/

// Injected into content pages

(function() {

'use strict';

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/464
if ( document instanceof HTMLDocument === false ) {
    //console.debug('contentscript-end.js > not a HTLMDocument');
    return false;
}

// This can happen
if ( !vAPI ) {
    //console.debug('contentscript-end.js > vAPI not found');
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/587
// Pointless to execute without the start script having done its job.
if ( !vAPI.contentscriptStartInjected ) {
    return;
}

// https://github.com/chrisaljoudi/uBlock/issues/456
// Already injected?
if ( vAPI.contentscriptEndInjected ) {
    //console.debug('contentscript-end.js > content script already injected');
    return;
}
vAPI.contentscriptEndInjected = true;

/******************************************************************************/

var localMessager = vAPI.messaging.channel('contentscript-end.js');

/******************************************************************************/
/******************************************************************************/

// This is to be executed only once: putting this code in its own closure
// means the code will be flushed from memory once executed.

(function() {

/******************************************************************************/

/*------------[ Unrendered Noscript (because CSP) Workaround ]----------------*/

var checkScriptBlacklistedHandler = function(response) {
    if ( !response.scriptBlacklisted ) {
        return;
    }
    var scripts = document.querySelectorAll('noscript');
    var i = scripts.length;
    var realNoscript, fakeNoscript;
    while ( i-- ) {
        realNoscript = scripts[i];
        fakeNoscript = document.createElement('div');
        fakeNoscript.innerHTML = '<!-- uMatrix NOSCRIPT tag replacement: see <https://github.com/gorhill/httpswitchboard/issues/177> -->\n' + realNoscript.textContent;
        realNoscript.parentNode.replaceChild(fakeNoscript, realNoscript);
    }
};

localMessager.send({
        what: 'checkScriptBlacklisted',
        url: window.location.href
}, checkScriptBlacklistedHandler);

/******************************************************************************/

var localStorageHandler = function(mustRemove) {
    if ( mustRemove ) {
        window.localStorage.clear();
        window.sessionStorage.clear();
        // console.debug('HTTP Switchboard > found and removed non-empty localStorage');
    }
};

// Check with extension whether local storage must be emptied
// rhill 2014-03-28: we need an exception handler in case 3rd-party access
// to site data is disabled.
// https://github.com/gorhill/httpswitchboard/issues/215
try {
    var hasLocalStorage = window.localStorage && window.localStorage.length;
    var hasSessionStorage = window.sessionStorage && window.sessionStorage.length;
    if ( hasLocalStorage || hasSessionStorage ) {
        localMessager.send({
                what: 'contentScriptHasLocalStorage',
                url: window.location.href
        }, localStorageHandler);
    }

    // TODO: indexedDB
    if ( window.indexedDB && !!window.indexedDB.webkitGetDatabaseNames ) {
        // var db = window.indexedDB.webkitGetDatabaseNames().onsuccess = function(sender) {
        //    console.debug('webkitGetDatabaseNames(): result=%o', sender.target.result);
        // };
    }

    // TODO: Web SQL
    if ( window.openDatabase ) {
        // Sad:
        // "There is no way to enumerate or delete the databases available for an origin from this API."
        // Ref.: http://www.w3.org/TR/webdatabase/#databases
    }
}
catch (e) {
}

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

(function() {

/******************************************************************************/

var nodesAddedHandler = function(nodeList, summary) {
    var i = 0;
    var node, src, text;
    while ( node = nodeList.item(i++) ) {
        if ( node.nodeType !== 1 ) {
            continue;
        }
        if ( typeof node.tagName !== 'string' ) {
            continue;
        }

        switch ( node.tagName.toUpperCase() ) {

        case 'SCRIPT':
            // https://github.com/gorhill/httpswitchboard/issues/252
            // Do not count µMatrix's own script tags, they are not required
            // to "unbreak" a web page
            if ( node.id && node.id.indexOf('uMatrix-') === 0 ) {
                break;
            }
            text = node.textContent.trim();
            if ( text !== '' ) {
                summary.scriptSources['{inline_script}'] = true;
                summary.mustReport = true;
            }
            src = (node.src || '').trim();
            if ( src !== '' ) {
                summary.scriptSources[src] = true;
                summary.mustReport = true;
            }
            break;

        case 'A':
            if ( node.href.indexOf('javascript:') === 0 ) {
                summary.scriptSources['{inline_script}'] = true;
                summary.mustReport = true;
            }
            break;

        case 'OBJECT':
            src = (node.data || '').trim();
            if ( src !== '' ) {
                summary.pluginSources[src] = true;
                summary.mustReport = true;
            }
            break;

        case 'EMBED':
            src = (node.src || '').trim();
            if ( src !== '' ) {
                summary.pluginSources[src] = true;
                summary.mustReport = true;
            }
            break;
        }
    }
};

/******************************************************************************/

var nodeListsAddedHandler = function(nodeLists) {
    var i = nodeLists.length;
    if ( i === 0 ) {
        return;
    }
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        scriptSources: {}, // to avoid duplicates
        pluginSources: {}, // to avoid duplicates
        mustReport: false
    };
    while ( i-- ) {
        nodesAddedHandler(nodeLists[i], summary);
    }
    if ( summary.mustReport ) {
        localMessager.send(summary);
    }
};

/******************************************************************************/

(function() {
    var summary = {
        what: 'contentScriptSummary',
        locationURL: window.location.href,
        scriptSources: {}, // to avoid duplicates
        pluginSources: {}, // to avoid duplicates
        mustReport: true
    };
    // https://github.com/gorhill/httpswitchboard/issues/25
    // &
    // Looks for inline javascript also in at least one a[href] element.
    // https://github.com/gorhill/httpswitchboard/issues/131
    nodesAddedHandler(document.querySelectorAll('script, a[href^="javascript:"], object, embed'), summary);

    //console.debug('contentscript-end.js > firstObservationHandler(): found %d script tags in "%s"', Object.keys(summary.scriptSources).length, window.location.href);

    localMessager.send(summary);
})();

/******************************************************************************/

// Observe changes in the DOM

// Added node lists will be cumulated here before being processed
var addedNodeLists = [];
var addedNodeListsTimer = null;

var treeMutationObservedHandler = function() {
    nodeListsAddedHandler(addedNodeLists);
    addedNodeListsTimer = null;
    addedNodeLists = [];
};

// https://github.com/gorhill/uBlock/issues/205
// Do not handle added node directly from within mutation observer.
var treeMutationObservedHandlerAsync = function(mutations) {
    var iMutation = mutations.length;
    var nodeList;
    while ( iMutation-- ) {
        nodeList = mutations[iMutation].addedNodes;
        if ( nodeList.length !== 0 ) {
            addedNodeLists.push(nodeList);
        }
    }
    // I arbitrarily chose 250 ms for now:
    // I have to compromise between the overhead of processing too few 
    // nodes too often and the delay of many nodes less often. There is nothing
    // time critical here.
    if ( addedNodeListsTimer === null ) {
        addedNodeListsTimer = setTimeout(treeMutationObservedHandler, 250);
    }
};

// This fixes http://acid3.acidtests.org/
if ( document.body ) {
    // https://github.com/gorhill/httpswitchboard/issues/176
    var treeObserver = new MutationObserver(treeMutationObservedHandlerAsync);
    treeObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/******************************************************************************/

})();

/******************************************************************************/
/******************************************************************************/

})();
