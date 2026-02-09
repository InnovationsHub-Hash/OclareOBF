'use strict';

let _sodium = null;
let _sodiumReady = Promise.resolve(null);
try {
    importScripts('https://cdn.jsdelivr.net/npm/libsodium-wrappers@0.7.9/dist/modules/libsodium-wrappers.js');
    if (typeof sodium !== 'undefined' && sodium && sodium.ready) {
        _sodiumReady = sodium.ready.then(() => { _sodium = sodium; return sodium; }).catch(() => null);
    }
} catch (e) { _sodiumReady = Promise.resolve(null); }

function postProgress(id, step, pct, msg) { self.postMessage({ type: 'progress', id, step, pct, msg }); }

const LuaTarget = {
    LUA_51: 'lua51', LUA_52: 'lua52', LUA_53: 'lua53',
    LUA_54: 'lua54', LUAJIT: 'luajit', LUAU: 'luau'
};

const LuaFeatures = {
    [LuaTarget.LUA_51]: { hasGoto: false, hasBitwise: false, hasIntegerDiv: false, hasUtf8: false, bitLib: 'bit', hasTableUnpack: false, hasTablePack: false, hasContinue: false, hasCompoundAssign: false },
    [LuaTarget.LUA_52]: { hasGoto: true, hasBitwise: false, hasIntegerDiv: false, hasUtf8: false, bitLib: 'bit32', hasTableUnpack: true, hasTablePack: true, hasContinue: false, hasCompoundAssign: false },
    [LuaTarget.LUA_53]: { hasGoto: true, hasBitwise: true, hasIntegerDiv: true, hasUtf8: true, bitLib: 'native', hasTableUnpack: true, hasTablePack: true, hasContinue: false, hasCompoundAssign: false },
    [LuaTarget.LUA_54]: { hasGoto: true, hasBitwise: true, hasIntegerDiv: true, hasUtf8: true, bitLib: 'native', hasTableUnpack: true, hasTablePack: true, hasConst: true, hasToClose: true, hasContinue: false, hasCompoundAssign: false },
    [LuaTarget.LUAJIT]: { hasGoto: true, hasBitwise: false, hasIntegerDiv: false, hasUtf8: false, bitLib: 'bit', hasTableUnpack: false, hasTablePack: false, hasContinue: false, hasCompoundAssign: false, hasFFI: true, hasJIT: true },
    [LuaTarget.LUAU]: { hasGoto: false, hasBitwise: true, hasIntegerDiv: true, hasUtf8: true, bitLib: 'bit32', hasTableUnpack: true, hasTablePack: true, hasContinue: true, hasCompoundAssign: true, hasTypeAnnotations: true, hasIfExpression: true }
};

const TokenType = {
    EOF: 'EOF', NUMBER: 'NUMBER', STRING: 'STRING', NAME: 'NAME', KEYWORD: 'KEYWORD',
    PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', PERCENT: '%', CARET: '^', HASH: '#',
    AMPERSAND: '&', PIPE: '|', TILDE: '~', LSHIFT: '<<', RSHIFT: '>>',
    SLASHSLASH: '//', EQ: '==', NEQ: '~=', LTE: '<=', GTE: '>=', LT: '<', GT: '>',
    ASSIGN: '=', LPAREN: '(', RPAREN: ')', LBRACE: '{', RBRACE: '}', LBRACKET: '[', RBRACKET: ']',
    SEMICOLON: ';', COLON: ':', COMMA: ',', DOT: '.', DOTDOT: '..', DOTDOTDOT: '...', DOUBLECOLON: '::',
    PLUSEQ: '+=', MINUSEQ: '-=', STAREQ: '*=', SLASHEQ: '/=', PERCENTEQ: '%=', CARETEQ: '^=', DOTDOTEQ: '..='
};

class BuildConfig {
    constructor(seed = null) {
        this.BUILD_TIMESTAMP = Date.now();
        this.entropy = this._gatherEntropy();
        this.BUILD_SEED = seed || (this.BUILD_TIMESTAMP.toString(36) + this.entropy);
        this.BUILD_ID = this.fnv1a(this.BUILD_SEED);
        this.rngState = new Uint32Array(4);
        this._initRng(this.BUILD_SEED);
        this._mixEntropy();
        this.runCounter = 0;
    }

    _gatherEntropy() {
        let e = '';
        e += Math.random().toString(36).substr(2, 16);
        e += Date.now().toString(36);
        e += (typeof performance !== 'undefined' && performance.now) ? performance.now().toString(36) : '';
        try {
            const arr = new Uint32Array(8);
            if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                crypto.getRandomValues(arr);
                for (let i = 0; i < 8; i++) e += arr[i].toString(36);
            }
        } catch (_) {}
        e += (typeof self !== 'undefined' ? Object.keys(self).length : 0).toString(36);
        e += Math.random().toString(36).substr(2, 8);
        return e;
    }

    _mixEntropy() {
        const ts = Date.now();
        const r1 = (Math.random() * 0xFFFFFFFF) >>> 0;
        const r2 = (Math.random() * 0xFFFFFFFF) >>> 0;
        this.rngState[0] ^= (ts & 0xFFFFFFFF) >>> 0;
        this.rngState[1] ^= r1;
        this.rngState[2] ^= r2;
        this.rngState[3] ^= ((ts >>> 16) ^ r1 ^ r2) >>> 0;
        if (this.rngState[0] === 0 && this.rngState[1] === 0 && this.rngState[2] === 0 && this.rngState[3] === 0) {
            this.rngState[0] = 1;
        }
        for (let i = 0; i < 16; i++) this.seededRandom();
    }

    fnv1a(str) {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
        }
        return hash;
    }

    _splitmix32(state) {
        state = (state + 0x9e3779b9) >>> 0;
        let z = state;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
        return { state, value: (z ^ (z >>> 16)) >>> 0 };
    }

    _initRng(seed) {
        let s = this.fnv1a(seed);
        for (let round = 0; round < 4; round++) {
            s = (s + 0x6a09e667) >>> 0;
            for (let i = 0; i < 4; i++) {
                const r = this._splitmix32(s);
                s = r.state;
                this.rngState[i] ^= r.value;
            }
        }
        if (this.rngState[0] === 0 && this.rngState[1] === 0 && this.rngState[2] === 0 && this.rngState[3] === 0) {
            this.rngState[0] = 1;
        }
        for (let i = 0; i < 20; i++) this.seededRandom();
    }

    _rotl32(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }

    seededRandom() {
        const s = this.rngState;
        const result = Math.imul(this._rotl32(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
        const t = (s[1] << 9) >>> 0;
        s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
        s[2] ^= t; s[3] = this._rotl32(s[3], 11);
        this.runCounter++;
        if (this.runCounter % 64 === 0) {
            s[0] ^= ((Math.random() * 0xFFFFFFFF) >>> 0);
            s[2] ^= (Date.now() & 0xFFFFFFFF) >>> 0;
        }
        return result / 0x100000000;
    }

    seededRandomInt(min, max) { return Math.floor(this.seededRandom() * (max - min + 1)) + min; }

    shuffleArray(arr) {
        const result = [...arr];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.seededRandomInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }

    generateKey(bits = 32) {
        let key = 0;
        for (let i = 0; i < bits; i += 8) key = (key << 8) | this.seededRandomInt(0, 255);
        return key >>> 0;
    }

    generateBytes(len) { const b = []; for (let i = 0; i < len; i++) b.push(this.seededRandomInt(0, 255)); return b; }

    generateId(len = 6) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let s = '_';
        for (let i = 0; i < len; i++) s += chars[this.seededRandomInt(0, chars.length - 1)];
        return s;
    }

    runtimeSalt() { return ((Math.random() * 0xFFFFFFFF) >>> 0) ^ (Date.now() & 0xFFFFFFFF); }
}

class LuaLexer {
    constructor(source, target = LuaTarget.LUA_53) {
        this.source = source;
        this.target = target;
        this.features = LuaFeatures[target];
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.keywords = this.getKeywords();
    }

    getKeywords() {
        const base = ['and','break','do','else','elseif','end','false','for','function','if','in','local','nil','not','or','repeat','return','then','true','until','while'];
        if (this.features.hasGoto) base.push('goto');
        if (this.features.hasContinue) base.push('continue');
        if (this.target === LuaTarget.LUAU) base.push('type','export','typeof');
        return base;
    }

    peek(offset = 0) { return this.source[this.pos + offset] || '\0'; }
    advance() { const c = this.peek(); this.pos++; if (c === '\n') { this.line++; this.col = 1; } else { this.col++; } return c; }

    skipWhitespaceAndComments() {
        while (this.pos < this.source.length) {
            const c = this.peek();
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { this.advance(); }
            else if (c === '-' && this.peek(1) === '-') {
                this.advance(); this.advance();
                if (this.peek() === '[' && (this.peek(1) === '[' || this.peek(1) === '=')) {
                    let eqCount = 0; this.advance();
                    while (this.peek() === '=') { this.advance(); eqCount++; }
                    if (this.peek() === '[') {
                        this.advance();
                        const closePattern = ']' + '='.repeat(eqCount) + ']';
                        while (this.pos < this.source.length) {
                            if (this.source.substring(this.pos, this.pos + closePattern.length) === closePattern) { this.pos += closePattern.length; break; }
                            this.advance();
                        }
                    }
                } else { while (this.pos < this.source.length && this.peek() !== '\n') this.advance(); }
            } else break;
        }
    }

    readString(quote) {
        let value = '';
        while (this.pos < this.source.length && this.peek() !== quote) {
            if (this.peek() === '\\') {
                this.advance();
                const esc = this.advance();
                const escapes = { 'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', '"': '"', "'": "'", '0': '\0', 'a': '\x07', 'b': '\b', 'f': '\f', 'v': '\v' };
                if (escapes[esc]) value += escapes[esc];
                else if (esc === 'x') { const hex = this.advance() + this.advance(); value += String.fromCharCode(parseInt(hex, 16)); }
                else if (esc === 'u' && this.peek() === '{') { this.advance(); let hex = ''; while (this.peek() !== '}') hex += this.advance(); this.advance(); value += String.fromCodePoint(parseInt(hex, 16)); }
                else if (/[0-9]/.test(esc)) { let num = esc; if (/[0-9]/.test(this.peek())) num += this.advance(); if (/[0-9]/.test(this.peek())) num += this.advance(); value += String.fromCharCode(parseInt(num, 10)); }
                else value += esc;
            } else { value += this.advance(); }
        }
        this.advance();
        return value;
    }

    readLongString() {
        let eqCount = 0;
        while (this.peek() === '=') { this.advance(); eqCount++; }
        if (this.peek() !== '[') return null;
        this.advance();
        if (this.peek() === '\n') this.advance();
        let value = '';
        const closePattern = ']' + '='.repeat(eqCount) + ']';
        while (this.pos < this.source.length) {
            if (this.source.substring(this.pos, this.pos + closePattern.length) === closePattern) { this.pos += closePattern.length; break; }
            value += this.advance();
        }
        return value;
    }

    readNumber() {
        let num = '';
        const isHex = this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X');
        const isBin = this.target === LuaTarget.LUAU && this.peek() === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B');
        if (isHex) {
            num += this.advance() + this.advance();
            while (/[0-9a-fA-F_]/.test(this.peek())) { if (this.peek() !== '_') num += this.advance(); else this.advance(); }
            if (this.peek() === '.' && /[0-9a-fA-F]/.test(this.peek(1))) { num += this.advance(); while (/[0-9a-fA-F_]/.test(this.peek())) { if (this.peek() !== '_') num += this.advance(); else this.advance(); } }
            if (this.peek() === 'p' || this.peek() === 'P') { num += this.advance(); if (this.peek() === '+' || this.peek() === '-') num += this.advance(); while (/[0-9]/.test(this.peek())) num += this.advance(); }
        } else if (isBin) {
            num += this.advance() + this.advance();
            while (/[01_]/.test(this.peek())) { if (this.peek() !== '_') num += this.advance(); else this.advance(); }
            return parseInt(num.slice(2), 2);
        } else {
            while (/[0-9_]/.test(this.peek())) { if (this.peek() !== '_') num += this.advance(); else this.advance(); }
            if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) { num += this.advance(); while (/[0-9_]/.test(this.peek())) { if (this.peek() !== '_') num += this.advance(); else this.advance(); } }
            if (this.peek() === 'e' || this.peek() === 'E') { num += this.advance(); if (this.peek() === '+' || this.peek() === '-') num += this.advance(); while (/[0-9]/.test(this.peek())) num += this.advance(); }
        }
        return parseFloat(num);
    }

    nextToken() {
        this.skipWhitespaceAndComments();
        if (this.pos >= this.source.length) return { type: TokenType.EOF, line: this.line, col: this.col };
        const line = this.line, col = this.col;
        const c = this.peek();
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(this.peek(1)))) return { type: TokenType.NUMBER, value: this.readNumber(), line, col };
        if (c === '"' || c === "'") { this.advance(); return { type: TokenType.STRING, value: this.readString(c), line, col }; }
        if (c === '`' && this.target === LuaTarget.LUAU) { this.advance(); return { type: TokenType.STRING, value: this.readString('`'), line, col, interpolated: true }; }
        if (c === '[' && (this.peek(1) === '[' || this.peek(1) === '=')) { this.advance(); const value = this.readLongString(); if (value !== null) return { type: TokenType.STRING, value, line, col }; }
        if (/[a-zA-Z_]/.test(c)) {
            let name = '';
            while (/[a-zA-Z0-9_]/.test(this.peek())) name += this.advance();
            if (this.keywords.includes(name)) return { type: TokenType.KEYWORD, value: name, line, col };
            return { type: TokenType.NAME, value: name, line, col };
        }
        if (this.features.hasCompoundAssign) {
            const threeChar = this.source.substring(this.pos, this.pos + 3);
            if (threeChar === '..=') { this.pos += 3; return { type: TokenType.DOTDOTEQ, line, col }; }
            const twoCharCompound = this.source.substring(this.pos, this.pos + 2);
            const compoundOps = { '+=': TokenType.PLUSEQ, '-=': TokenType.MINUSEQ, '*=': TokenType.STAREQ, '/=': TokenType.SLASHEQ, '%=': TokenType.PERCENTEQ, '^=': TokenType.CARETEQ };
            if (compoundOps[twoCharCompound]) { this.pos += 2; return { type: compoundOps[twoCharCompound], line, col }; }
        }
        const twoChar = this.source.substring(this.pos, this.pos + 2);
        const twoCharOps = { '==': TokenType.EQ, '~=': TokenType.NEQ, '<=': TokenType.LTE, '>=': TokenType.GTE, '<<': TokenType.LSHIFT, '>>': TokenType.RSHIFT, '//': TokenType.SLASHSLASH, '::': TokenType.DOUBLECOLON };
        if (twoCharOps[twoChar]) { this.advance(); this.advance(); return { type: twoCharOps[twoChar], line, col }; }
        if (twoChar === '..') { this.advance(); this.advance(); if (this.peek() === '.') { this.advance(); return { type: TokenType.DOTDOTDOT, line, col }; } return { type: TokenType.DOTDOT, line, col }; }
        const oneCharOps = { '+': TokenType.PLUS, '-': TokenType.MINUS, '*': TokenType.STAR, '/': TokenType.SLASH, '%': TokenType.PERCENT, '^': TokenType.CARET, '#': TokenType.HASH, '&': TokenType.AMPERSAND, '|': TokenType.PIPE, '~': TokenType.TILDE, '<': TokenType.LT, '>': TokenType.GT, '=': TokenType.ASSIGN, '(': TokenType.LPAREN, ')': TokenType.RPAREN, '{': TokenType.LBRACE, '}': TokenType.RBRACE, '[': TokenType.LBRACKET, ']': TokenType.RBRACKET, ';': TokenType.SEMICOLON, ':': TokenType.COLON, ',': TokenType.COMMA, '.': TokenType.DOT };
        if (oneCharOps[c]) { this.advance(); return { type: oneCharOps[c], line, col }; }
        this.advance();
        return { type: 'UNKNOWN', value: c, line, col };
    }

    tokenize() {
        const tokens = [];
        let tok;
        while ((tok = this.nextToken()).type !== TokenType.EOF) tokens.push(tok);
        tokens.push(tok);
        return tokens;
    }
}

class LuaParser {
    constructor(tokens, target = LuaTarget.LUA_53) {
        this.tokens = tokens;
        this.target = target;
        this.features = LuaFeatures[target];
        this.pos = 0;
    }

    peek(offset = 0) { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }
    advance() { return this.tokens[this.pos++]; }
    check(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
    match(type, value) { if (this.check(type, value)) { this.advance(); return true; } return false; }
    expect(type, value) { if (!this.match(type, value)) throw new Error(`Expected ${value || type} at line ${this.peek().line}`); }
    isKeyword(kw) { return this.check(TokenType.KEYWORD, kw); }
    matchKeyword(kw) { return this.match(TokenType.KEYWORD, kw); }
    parse() { return this.parseBlock(); }

    parseBlock() {
        const statements = [];
        while (!this.check(TokenType.EOF) && !this.isKeyword('end') && !this.isKeyword('else') && !this.isKeyword('elseif') && !this.isKeyword('until')) {
            const stmt = this.parseStatement();
            if (stmt) statements.push(stmt);
        }
        return { type: 'Block', body: statements };
    }

    parseStatement() {
        if (this.match(TokenType.SEMICOLON)) return null;
        if (this.matchKeyword('local')) {
            if (this.matchKeyword('function')) {
                const name = this.advance().value;
                return { type: 'LocalFunction', name, func: this.parseFunctionBody() };
            }
            const names = [this.advance().value];
            while (this.match(TokenType.COMMA)) names.push(this.advance().value);
            let values = [];
            if (this.match(TokenType.ASSIGN)) values = this.parseExpressionList();
            return { type: 'Local', names, values };
        }
        if (this.matchKeyword('function')) {
            const name = this.parseFunctionName();
            return { type: 'FunctionDecl', name, func: this.parseFunctionBody() };
        }
        if (this.matchKeyword('if')) {
            const clauses = [];
            const cond = this.parseExpression();
            this.expect(TokenType.KEYWORD, 'then');
            const then = this.parseBlock();
            clauses.push({ condition: cond, body: then });
            while (this.matchKeyword('elseif')) {
                const elifCond = this.parseExpression();
                this.expect(TokenType.KEYWORD, 'then');
                clauses.push({ condition: elifCond, body: this.parseBlock() });
            }
            let elseBody = null;
            if (this.matchKeyword('else')) elseBody = this.parseBlock();
            this.expect(TokenType.KEYWORD, 'end');
            return { type: 'If', clauses, elseBody };
        }
        if (this.matchKeyword('while')) {
            const condition = this.parseExpression();
            this.expect(TokenType.KEYWORD, 'do');
            const body = this.parseBlock();
            this.expect(TokenType.KEYWORD, 'end');
            return { type: 'While', condition, body };
        }
        if (this.matchKeyword('repeat')) {
            const body = this.parseBlock();
            this.expect(TokenType.KEYWORD, 'until');
            const condition = this.parseExpression();
            return { type: 'Repeat', body, condition };
        }
        if (this.matchKeyword('for')) {
            const firstName = this.advance().value;
            if (this.match(TokenType.ASSIGN)) {
                const start = this.parseExpression();
                this.expect(TokenType.COMMA);
                const limit = this.parseExpression();
                let step = null;
                if (this.match(TokenType.COMMA)) step = this.parseExpression();
                this.expect(TokenType.KEYWORD, 'do');
                const body = this.parseBlock();
                this.expect(TokenType.KEYWORD, 'end');
                return { type: 'ForNum', var: firstName, start, limit, step, body };
            } else {
                const names = [firstName];
                while (this.match(TokenType.COMMA)) names.push(this.advance().value);
                this.expect(TokenType.KEYWORD, 'in');
                const exprs = this.parseExpressionList();
                this.expect(TokenType.KEYWORD, 'do');
                const body = this.parseBlock();
                this.expect(TokenType.KEYWORD, 'end');
                return { type: 'ForIn', names, exprs, body };
            }
        }
        if (this.matchKeyword('do')) {
            const body = this.parseBlock();
            this.expect(TokenType.KEYWORD, 'end');
            return { type: 'Do', body };
        }
        if (this.matchKeyword('return')) {
            const values = [];
            if (!this.check(TokenType.EOF) && !this.isKeyword('end') && !this.isKeyword('else') && !this.isKeyword('elseif') && !this.isKeyword('until') && !this.check(TokenType.SEMICOLON)) {
                values.push(...this.parseExpressionList());
            }
            this.match(TokenType.SEMICOLON);
            return { type: 'Return', values };
        }
        if (this.matchKeyword('break')) return { type: 'Break' };
        if (this.features.hasContinue && this.matchKeyword('continue')) return { type: 'Continue' };
        if (this.features.hasGoto && this.matchKeyword('goto')) { const label = this.advance().value; return { type: 'Goto', label }; }
        if (this.match(TokenType.DOUBLECOLON)) { const label = this.advance().value; this.expect(TokenType.DOUBLECOLON); return { type: 'Label', name: label }; }
        const expr = this.parsePrefixExpression();
        if (this.check(TokenType.ASSIGN) || this.check(TokenType.COMMA)) {
            const targets = [expr];
            while (this.match(TokenType.COMMA)) targets.push(this.parsePrefixExpression());
            this.expect(TokenType.ASSIGN);
            const values = this.parseExpressionList();
            return { type: 'Assignment', targets, values };
        }
        if (this.features.hasCompoundAssign) {
            const compoundOps = [TokenType.PLUSEQ, TokenType.MINUSEQ, TokenType.STAREQ, TokenType.SLASHEQ, TokenType.PERCENTEQ, TokenType.CARETEQ, TokenType.DOTDOTEQ];
            for (const op of compoundOps) {
                if (this.check(op)) {
                    const opType = this.advance().type;
                    const value = this.parseExpression();
                    return { type: 'CompoundAssignment', target: expr, op: opType, value };
                }
            }
        }
        return { type: 'ExpressionStatement', expression: this.finishCall(expr) };
    }

    parseFunctionName() {
        let name = { type: 'Identifier', name: this.advance().value };
        while (this.match(TokenType.DOT)) name = { type: 'MemberAccess', object: name, property: this.advance().value, computed: false };
        if (this.match(TokenType.COLON)) name = { type: 'MethodName', object: name, method: this.advance().value };
        return name;
    }

    parseFunctionBody() {
        this.expect(TokenType.LPAREN);
        const params = [];
        let vararg = false;
        if (!this.check(TokenType.RPAREN)) {
            do {
                if (this.match(TokenType.DOTDOTDOT)) { vararg = true; break; }
                const paramName = this.advance().value;
                let paramType = null;
                if (this.target === LuaTarget.LUAU && this.match(TokenType.COLON)) paramType = this.parseType();
                params.push({ name: paramName, type: paramType });
            } while (this.match(TokenType.COMMA));
        }
        this.expect(TokenType.RPAREN);
        let returnType = null;
        if (this.target === LuaTarget.LUAU && this.match(TokenType.COLON)) returnType = this.parseType();
        const body = this.parseBlock();
        this.expect(TokenType.KEYWORD, 'end');
        return { type: 'Function', params, vararg, body, returnType };
    }

    parseType() {
        let typeName = this.advance().value;
        if (this.match(TokenType.LT)) {
            const typeArgs = [this.parseType()];
            while (this.match(TokenType.COMMA)) typeArgs.push(this.parseType());
            this.expect(TokenType.GT);
            return { type: 'GenericType', name: typeName, args: typeArgs };
        }
        if (this.match(TokenType.PIPE)) {
            const types = [{ type: 'SimpleType', name: typeName }];
            types.push(this.parseType());
            return { type: 'UnionType', types };
        }
        return { type: 'SimpleType', name: typeName };
    }

    parseExpressionList() {
        const exprs = [this.parseExpression()];
        while (this.match(TokenType.COMMA)) exprs.push(this.parseExpression());
        return exprs;
    }

    parseExpression() { return this.parseOr(); }

    parseOr() {
        let left = this.parseAnd();
        while (this.matchKeyword('or')) { const right = this.parseAnd(); left = { type: 'BinaryOp', op: 'or', left, right }; }
        return left;
    }

    parseAnd() {
        let left = this.parseComparison();
        while (this.matchKeyword('and')) { const right = this.parseComparison(); left = { type: 'BinaryOp', op: 'and', left, right }; }
        return left;
    }

    parseComparison() {
        let left = this.parseBitOr();
        const ops = [TokenType.LT, TokenType.GT, TokenType.LTE, TokenType.GTE, TokenType.EQ, TokenType.NEQ];
        while (ops.some(op => this.check(op))) { const op = this.advance().type; const right = this.parseBitOr(); left = { type: 'BinaryOp', op, left, right }; }
        return left;
    }

    parseBitOr() { let left = this.parseBitXor(); while (this.match(TokenType.PIPE)) { const right = this.parseBitXor(); left = { type: 'BinaryOp', op: '|', left, right }; } return left; }
    parseBitXor() { let left = this.parseBitAnd(); while (this.check(TokenType.TILDE) && !this.check(TokenType.ASSIGN)) { this.advance(); const right = this.parseBitAnd(); left = { type: 'BinaryOp', op: '~', left, right }; } return left; }
    parseBitAnd() { let left = this.parseShift(); while (this.match(TokenType.AMPERSAND)) { const right = this.parseShift(); left = { type: 'BinaryOp', op: '&', left, right }; } return left; }
    parseShift() { let left = this.parseConcat(); while (this.check(TokenType.LSHIFT) || this.check(TokenType.RSHIFT)) { const op = this.advance().type; const right = this.parseConcat(); left = { type: 'BinaryOp', op, left, right }; } return left; }
    parseConcat() { let left = this.parseAddSub(); if (this.match(TokenType.DOTDOT)) { const right = this.parseConcat(); left = { type: 'BinaryOp', op: '..', left, right }; } return left; }
    parseAddSub() { let left = this.parseMulDiv(); while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) { const op = this.advance().type; const right = this.parseMulDiv(); left = { type: 'BinaryOp', op, left, right }; } return left; }
    parseMulDiv() { let left = this.parseUnary(); while (this.check(TokenType.STAR) || this.check(TokenType.SLASH) || this.check(TokenType.PERCENT) || this.check(TokenType.SLASHSLASH)) { const op = this.advance().type; const right = this.parseUnary(); left = { type: 'BinaryOp', op, left, right }; } return left; }

    parseUnary() {
        if (this.matchKeyword('not')) return { type: 'UnaryOp', op: 'not', operand: this.parseUnary() };
        if (this.match(TokenType.MINUS)) return { type: 'UnaryOp', op: '-', operand: this.parseUnary() };
        if (this.match(TokenType.HASH)) return { type: 'UnaryOp', op: '#', operand: this.parseUnary() };
        if (this.match(TokenType.TILDE)) return { type: 'UnaryOp', op: '~', operand: this.parseUnary() };
        return this.parsePower();
    }

    parsePower() {
        let left = this.parsePrefixExpression();
        if (this.match(TokenType.CARET)) { const right = this.parseUnary(); left = { type: 'BinaryOp', op: '^', left, right }; }
        return left;
    }

    parsePrefixExpression() {
        let expr;
        if (this.match(TokenType.LPAREN)) { expr = this.parseExpression(); this.expect(TokenType.RPAREN); expr = { type: 'Grouped', expression: expr }; }
        else if (this.check(TokenType.NAME)) { expr = { type: 'Identifier', name: this.advance().value }; }
        else { expr = this.parsePrimaryExpression(); }
        return this.finishCall(expr);
    }

    finishCall(expr) {
        while (true) {
            if (this.match(TokenType.DOT)) { const name = this.advance().value; expr = { type: 'MemberAccess', object: expr, property: name, computed: false }; }
            else if (this.match(TokenType.LBRACKET)) { const index = this.parseExpression(); this.expect(TokenType.RBRACKET); expr = { type: 'IndexAccess', object: expr, index }; }
            else if (this.match(TokenType.COLON)) { const method = this.advance().value; const args = this.parseCallArgs(); expr = { type: 'MethodCall', object: expr, method, args }; }
            else if (this.check(TokenType.LPAREN) || this.check(TokenType.LBRACE) || this.check(TokenType.STRING)) { const args = this.parseCallArgs(); expr = { type: 'Call', func: expr, args }; }
            else break;
        }
        return expr;
    }

    parseCallArgs() {
        if (this.match(TokenType.LPAREN)) { if (this.match(TokenType.RPAREN)) return []; const args = this.parseExpressionList(); this.expect(TokenType.RPAREN); return args; }
        else if (this.check(TokenType.LBRACE)) return [this.parseTableConstructor()];
        else if (this.check(TokenType.STRING)) return [{ type: 'Literal', value: this.advance().value, kind: 'string' }];
        return [];
    }

    parsePrimaryExpression() {
        if (this.matchKeyword('nil')) return { type: 'Literal', value: null, kind: 'nil' };
        if (this.matchKeyword('true')) return { type: 'Literal', value: true, kind: 'boolean' };
        if (this.matchKeyword('false')) return { type: 'Literal', value: false, kind: 'boolean' };
        if (this.check(TokenType.NUMBER)) return { type: 'Literal', value: this.advance().value, kind: 'number' };
        if (this.check(TokenType.STRING)) return { type: 'Literal', value: this.advance().value, kind: 'string' };
        if (this.match(TokenType.DOTDOTDOT)) return { type: 'Vararg' };
        if (this.matchKeyword('function')) return this.parseFunctionBody();
        if (this.check(TokenType.LBRACE)) return this.parseTableConstructor();
        if (this.features.hasIfExpression && this.matchKeyword('if')) return this.parseIfExpression();
        throw new Error(`Unexpected token ${this.peek().type} at line ${this.peek().line}`);
    }

    parseIfExpression() {
        const condition = this.parseExpression();
        this.expect(TokenType.KEYWORD, 'then');
        const thenExpr = this.parseExpression();
        let elseExpr;
        if (this.matchKeyword('elseif')) elseExpr = this.parseIfExpression();
        else { this.expect(TokenType.KEYWORD, 'else'); elseExpr = this.parseExpression(); }
        return { type: 'IfExpression', condition, thenExpr, elseExpr };
    }

    parseTableConstructor() {
        this.expect(TokenType.LBRACE);
        const fields = [];
        while (!this.check(TokenType.RBRACE)) {
            if (this.match(TokenType.LBRACKET)) { const key = this.parseExpression(); this.expect(TokenType.RBRACKET); this.expect(TokenType.ASSIGN); const value = this.parseExpression(); fields.push({ type: 'computed', key, value }); }
            else if (this.check(TokenType.NAME) && this.peek(1).type === TokenType.ASSIGN) { const key = this.advance().value; this.expect(TokenType.ASSIGN); const value = this.parseExpression(); fields.push({ type: 'named', key, value }); }
            else { const value = this.parseExpression(); fields.push({ type: 'array', value }); }
            if (!this.match(TokenType.COMMA) && !this.match(TokenType.SEMICOLON)) break;
        }
        this.expect(TokenType.RBRACE);
        return { type: 'Table', fields };
    }
}

const IROp = {
    LOAD_NIL: 'LOAD_NIL', LOAD_TRUE: 'LOAD_TRUE', LOAD_FALSE: 'LOAD_FALSE',
    LOAD_CONST: 'LOAD_CONST', LOAD_LOCAL: 'LOAD_LOCAL', STORE_LOCAL: 'STORE_LOCAL',
    LOAD_GLOBAL: 'LOAD_GLOBAL', STORE_GLOBAL: 'STORE_GLOBAL',
    LOAD_UPVALUE: 'LOAD_UPVALUE', STORE_UPVALUE: 'STORE_UPVALUE',
    ADD: 'ADD', SUB: 'SUB', MUL: 'MUL', DIV: 'DIV', MOD: 'MOD', POW: 'POW', IDIV: 'IDIV',
    NEGATE: 'NEGATE', NOT: 'NOT', LEN: 'LEN', BNOT: 'BNOT',
    CONCAT: 'CONCAT',
    BAND: 'BAND', BOR: 'BOR', BXOR: 'BXOR', SHL: 'SHL', SHR: 'SHR',
    EQ: 'EQ', NEQ: 'NEQ', LT: 'LT', LE: 'LE', GT: 'GT', GE: 'GE',
    JUMP: 'JUMP', JUMP_TRUE: 'JUMP_TRUE', JUMP_FALSE: 'JUMP_FALSE', JUMP_NIL: 'JUMP_NIL',
    LABEL: 'LABEL',
    NEW_TABLE: 'NEW_TABLE', GET_TABLE: 'GET_TABLE', SET_TABLE: 'SET_TABLE',
    CALL: 'CALL', SELF_CALL: 'SELF_CALL', RETURN: 'RETURN',
    MRET: 'MRET',
    CLOSURE: 'CLOSURE', VARARG: 'VARARG',
    INIT_LOCAL: 'INIT_LOCAL',
    FOR_PREP: 'FOR_PREP', FOR_LOOP: 'FOR_LOOP', TFOR_CALL: 'TFOR_CALL', TFOR_LOOP: 'TFOR_LOOP',
    DUP: 'DUP', POP: 'POP', SWAP: 'SWAP', ROT3: 'ROT3',
    ENTER_SCOPE: 'ENTER_SCOPE', EXIT_SCOPE: 'EXIT_SCOPE',
    INTEGRITY_CHECK: 'INTEGRITY_CHECK', TIMING_CHECK: 'TIMING_CHECK',
    NOP: 'NOP', HALT: 'HALT'
};

class IRBuilder {
    constructor() {
        this.instructions = [];
        this.constants = [];
        this.locals = [];
        this.scopeDepth = 0;
        this.labelCounter = 0;
        this.loopStack = [];
        this.closures = [];
    }

    ir(op, args = {}) {
        this.instructions.push({ op, ...args });
        return this.instructions.length - 1;
    }

    newLabel() { return `L${this.labelCounter++}`; }
    placeLabel(name) { this.ir(IROp.LABEL, { name }); }

    addConstant(value) {
        for (let i = 0; i < this.constants.length; i++) {
            if (this.constants[i] === value) return i;
            if (typeof this.constants[i] === 'object' && typeof value === 'object' && JSON.stringify(this.constants[i]) === JSON.stringify(value)) return i;
        }
        this.constants.push(value);
        return this.constants.length - 1;
    }

    addLocal(name) {
        this.locals.push({ name, depth: this.scopeDepth });
        const idx = this.locals.length - 1;
        this.ir(IROp.INIT_LOCAL, { index: idx });
        return idx;
    }

    resolveLocal(name) {
        for (let i = this.locals.length - 1; i >= 0; i--) {
            if (this.locals[i].name === name) return i;
        }
        return -1;
    }

    beginScope() { this.scopeDepth++; this.ir(IROp.ENTER_SCOPE); }
    endScope() {
        this.scopeDepth--;
        while (this.locals.length > 0 && this.locals[this.locals.length - 1].depth > this.scopeDepth) {
            this.locals.pop();
        }
        this.ir(IROp.EXIT_SCOPE);
    }

    lower(ast) {
        this.ir(IROp.INTEGRITY_CHECK, { kind: 'debug' });
        this.ir(IROp.INTEGRITY_CHECK, { kind: 'env' });
        this.ir(IROp.INTEGRITY_CHECK, { kind: 'hook' });
        this.ir(IROp.INTEGRITY_CHECK, { kind: 'emu' });
        this.ir(IROp.INTEGRITY_CHECK, { kind: 'sandbox' });
        this.lowerNode(ast);
        this.ir(IROp.HALT);
        return { instructions: this.instructions, constants: this.constants, closures: this.closures };
    }

    lowerNode(node) {
        if (!node) return;
        const fn = this[`lower_${node.type}`];
        if (fn) fn.call(this, node);
        else throw new Error(`IR: unhandled node type ${node.type}`);
    }

    lower_Block(node) {
        this.beginScope();
        for (const stmt of node.body) this.lowerNode(stmt);
        this.endScope();
    }

    lower_Local(node) {
        const lastIsCall = node.values.length > 0 && (node.values[node.values.length - 1].type === 'Call' || node.values[node.values.length - 1].type === 'MethodCall');
        if (lastIsCall && node.values.length <= node.names.length) {
            for (let i = 0; i < node.values.length - 1; i++) this.lowerNode(node.values[i]);
            this.lowerNode(node.values[node.values.length - 1]);
            const needed = node.names.length - (node.values.length - 1);
            this.ir(IROp.MRET, { count: needed });
            for (let i = 0; i < node.values.length - 1; i++) {
                this.addLocal(node.names[i]);
                this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal(node.names[i]) });
            }
            for (let i = node.values.length - 1; i < node.names.length; i++) {
                this.addLocal(node.names[i]);
                this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal(node.names[i]) });
            }
        } else {
            for (let i = 0; i < node.names.length; i++) {
                if (i < node.values.length) this.lowerNode(node.values[i]);
                else this.ir(IROp.LOAD_NIL);
                this.addLocal(node.names[i]);
                this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal(node.names[i]) });
            }
        }
    }

    lower_Assignment(node) {
        for (let i = 0; i < node.values.length; i++) this.lowerNode(node.values[i]);
        for (let i = node.values.length; i < node.targets.length; i++) this.ir(IROp.LOAD_NIL);
        for (let i = node.targets.length - 1; i >= 0; i--) this.lowerAssignTarget(node.targets[i]);
    }

    lowerAssignTarget(target) {
        if (target.type === 'Identifier') {
            const loc = this.resolveLocal(target.name);
            if (loc !== -1) this.ir(IROp.STORE_LOCAL, { index: loc });
            else { const idx = this.addConstant(target.name); this.ir(IROp.STORE_GLOBAL, { constIdx: idx }); }
        } else if (target.type === 'IndexAccess') {
            this.lowerNode(target.object);
            this.lowerNode(target.index);
            this.ir(IROp.ROT3);
            this.ir(IROp.SET_TABLE);
        } else if (target.type === 'MemberAccess') {
            this.lowerNode(target.object);
            const idx = this.addConstant(target.property);
            this.ir(IROp.LOAD_CONST, { constIdx: idx });
            this.ir(IROp.ROT3);
            this.ir(IROp.SET_TABLE);
        }
    }

    lower_CompoundAssignment(node) {
        this.lowerNode(node.target);
        this.lowerNode(node.value);
        const opMap = { [TokenType.PLUSEQ]: IROp.ADD, [TokenType.MINUSEQ]: IROp.SUB, [TokenType.STAREQ]: IROp.MUL, [TokenType.SLASHEQ]: IROp.DIV, [TokenType.PERCENTEQ]: IROp.MOD, [TokenType.CARETEQ]: IROp.POW, [TokenType.DOTDOTEQ]: IROp.CONCAT };
        this.ir(opMap[node.op]);
        this.lowerAssignTarget(node.target);
    }

    lower_If(node) {
        const endLabel = this.newLabel();
        for (let i = 0; i < node.clauses.length; i++) {
            const clause = node.clauses[i];
            const nextLabel = this.newLabel();
            this.lowerNode(clause.condition);
            this.ir(IROp.JUMP_FALSE, { label: nextLabel });
            this.lowerNode(clause.body);
            this.ir(IROp.JUMP, { label: endLabel });
            this.placeLabel(nextLabel);
        }
        if (node.elseBody) this.lowerNode(node.elseBody);
        this.placeLabel(endLabel);
    }

    lower_IfExpression(node) {
        const elseLabel = this.newLabel();
        const endLabel = this.newLabel();
        this.lowerNode(node.condition);
        this.ir(IROp.JUMP_FALSE, { label: elseLabel });
        this.lowerNode(node.thenExpr);
        this.ir(IROp.JUMP, { label: endLabel });
        this.placeLabel(elseLabel);
        this.lowerNode(node.elseExpr);
        this.placeLabel(endLabel);
    }

    lower_While(node) {
        const loopLabel = this.newLabel();
        const endLabel = this.newLabel();
        const contLabel = this.newLabel();
        this.loopStack.push({ breakLabel: endLabel, continueLabel: contLabel });
        this.placeLabel(loopLabel);
        this.ir(IROp.TIMING_CHECK);
        this.lowerNode(node.condition);
        this.ir(IROp.JUMP_FALSE, { label: endLabel });
        this.lowerNode(node.body);
        this.placeLabel(contLabel);
        this.ir(IROp.JUMP, { label: loopLabel });
        this.placeLabel(endLabel);
        this.loopStack.pop();
    }

    lower_Repeat(node) {
        const loopLabel = this.newLabel();
        const endLabel = this.newLabel();
        const contLabel = this.newLabel();
        this.loopStack.push({ breakLabel: endLabel, continueLabel: contLabel });
        this.placeLabel(loopLabel);
        this.ir(IROp.TIMING_CHECK);
        this.lowerNode(node.body);
        this.placeLabel(contLabel);
        this.lowerNode(node.condition);
        this.ir(IROp.JUMP_TRUE, { label: endLabel });
        this.ir(IROp.JUMP, { label: loopLabel });
        this.placeLabel(endLabel);
        this.loopStack.pop();
    }

    lower_ForNum(node) {
        this.beginScope();
        this.lowerNode(node.start);
        this.addLocal(node.var);
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal(node.var) });
        this.lowerNode(node.limit);
        this.addLocal('(limit)');
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal('(limit)') });
        if (node.step) this.lowerNode(node.step);
        else { const idx = this.addConstant(1); this.ir(IROp.LOAD_CONST, { constIdx: idx }); }
        this.addLocal('(step)');
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal('(step)') });
        const loopLabel = this.newLabel();
        const endLabel = this.newLabel();
        const contLabel = this.newLabel();
        this.loopStack.push({ breakLabel: endLabel, continueLabel: contLabel });
        this.placeLabel(loopLabel);
        this.ir(IROp.TIMING_CHECK);
        const varIdx = this.resolveLocal(node.var);
        const limitIdx = this.resolveLocal('(limit)');
        const stepIdx = this.resolveLocal('(step)');
        this.ir(IROp.LOAD_LOCAL, { index: varIdx });
        this.ir(IROp.LOAD_LOCAL, { index: limitIdx });
        this.ir(IROp.LOAD_LOCAL, { index: stepIdx });
        this.ir(IROp.FOR_LOOP);
        this.ir(IROp.JUMP_FALSE, { label: endLabel });
        this.lowerNode(node.body);
        this.placeLabel(contLabel);
        this.ir(IROp.LOAD_LOCAL, { index: varIdx });
        this.ir(IROp.LOAD_LOCAL, { index: stepIdx });
        this.ir(IROp.ADD);
        this.ir(IROp.STORE_LOCAL, { index: varIdx });
        this.ir(IROp.JUMP, { label: loopLabel });
        this.placeLabel(endLabel);
        this.loopStack.pop();
        this.endScope();
    }

    lower_ForIn(node) {
        this.beginScope();
        for (const expr of node.exprs) this.lowerNode(expr);
        const padCount = 3 - node.exprs.length;
        for (let i = 0; i < padCount; i++) this.ir(IROp.LOAD_NIL);
        this.addLocal('(iter)');
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal('(iter)') });
        this.addLocal('(state)');
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal('(state)') });
        this.addLocal('(control)');
        this.ir(IROp.STORE_LOCAL, { index: this.resolveLocal('(control)') });
        for (const name of node.names) {
            this.addLocal(name);
        }
        const loopLabel = this.newLabel();
        const endLabel = this.newLabel();
        const contLabel = this.newLabel();
        this.loopStack.push({ breakLabel: endLabel, continueLabel: contLabel });
        this.placeLabel(loopLabel);
        this.ir(IROp.TIMING_CHECK);
        const iterIdx = this.resolveLocal('(iter)');
        const stateIdx = this.resolveLocal('(state)');
        const controlIdx = this.resolveLocal('(control)');
        this.ir(IROp.TFOR_CALL, { iterIdx, stateIdx, controlIdx, names: node.names.length });
        const firstVarIdx = this.resolveLocal(node.names[0]);
        for (let i = 0; i < node.names.length; i++) {
            this.ir(IROp.STORE_LOCAL, { index: firstVarIdx + i, fromTfor: true, tforIndex: i });
        }
        this.ir(IROp.LOAD_LOCAL, { index: firstVarIdx });
        this.ir(IROp.JUMP_NIL, { label: endLabel });
        this.ir(IROp.LOAD_LOCAL, { index: firstVarIdx });
        this.ir(IROp.STORE_LOCAL, { index: controlIdx });
        this.lowerNode(node.body);
        this.placeLabel(contLabel);
        this.ir(IROp.JUMP, { label: loopLabel });
        this.placeLabel(endLabel);
        this.loopStack.pop();
        this.endScope();
    }

    lower_Do(node) { this.lowerNode(node.body); }

    lower_Return(node) {
        for (const val of node.values) this.lowerNode(val);
        this.ir(IROp.RETURN, { count: node.values.length });
    }

    lower_Break() {
        if (this.loopStack.length === 0) throw new Error('Break outside loop');
        this.ir(IROp.JUMP, { label: this.loopStack[this.loopStack.length - 1].breakLabel });
    }

    lower_Continue() {
        if (this.loopStack.length === 0) throw new Error('Continue outside loop');
        this.ir(IROp.JUMP, { label: this.loopStack[this.loopStack.length - 1].continueLabel });
    }

    lower_Label() {}
    lower_Goto() {}

    lower_ExpressionStatement(node) {
        this.lowerNode(node.expression);
        this.ir(IROp.POP);
    }

    lower_FunctionDecl(node) {
        this.lowerNode(node.func);
        if (node.name.type === 'Identifier') {
            const loc = this.resolveLocal(node.name.name);
            if (loc !== -1) this.ir(IROp.STORE_LOCAL, { index: loc });
            else { const idx = this.addConstant(node.name.name); this.ir(IROp.STORE_GLOBAL, { constIdx: idx }); }
        } else if (node.name.type === 'MemberAccess' || node.name.type === 'MethodName') {
            this.lowerAssignTarget(node.name.type === 'MethodName' ? { type: 'MemberAccess', object: node.name.object, property: node.name.method, computed: false } : node.name);
        }
    }

    lower_LocalFunction(node) {
        this.addLocal(node.name);
        this.lowerNode(node.func);
        const loc = this.resolveLocal(node.name);
        this.ir(IROp.STORE_LOCAL, { index: loc });
    }

    lower_Function(node) {
        const subBuilder = new IRBuilder();
        subBuilder.scopeDepth = 1;
        for (const param of node.params) {
            const paramName = typeof param === 'string' ? param : param.name;
            subBuilder.addLocal(paramName);
        }
        if (node.vararg) subBuilder.addLocal('...');
        subBuilder.lowerNode(node.body);
        subBuilder.ir(IROp.LOAD_NIL);
        subBuilder.ir(IROp.RETURN, { count: 1 });
        const closureIdx = this.closures.length;
        this.closures.push({
            ir: subBuilder.instructions,
            constants: subBuilder.constants,
            closures: subBuilder.closures,
            params: node.params.length,
            vararg: node.vararg
        });
        const funcData = { _t: 'func', _closureIdx: closureIdx, _p: node.params.length, _va: node.vararg };
        const idx = this.addConstant(funcData);
        this.ir(IROp.CLOSURE, { constIdx: idx });
    }

    lower_Literal(node) {
        if (node.kind === 'nil') this.ir(IROp.LOAD_NIL);
        else if (node.kind === 'boolean') this.ir(node.value ? IROp.LOAD_TRUE : IROp.LOAD_FALSE);
        else { const idx = this.addConstant(node.value); this.ir(IROp.LOAD_CONST, { constIdx: idx }); }
    }

    lower_Identifier(node) {
        const loc = this.resolveLocal(node.name);
        if (loc !== -1) this.ir(IROp.LOAD_LOCAL, { index: loc });
        else { const idx = this.addConstant(node.name); this.ir(IROp.LOAD_GLOBAL, { constIdx: idx }); }
    }

    lower_Grouped(node) { this.lowerNode(node.expression); }

    lower_BinaryOp(node) {
        if (node.op === 'and') {
            const endLabel = this.newLabel();
            this.lowerNode(node.left);
            this.ir(IROp.DUP);
            this.ir(IROp.JUMP_FALSE, { label: endLabel });
            this.ir(IROp.POP);
            this.lowerNode(node.right);
            this.placeLabel(endLabel);
            return;
        }
        if (node.op === 'or') {
            const endLabel = this.newLabel();
            this.lowerNode(node.left);
            this.ir(IROp.DUP);
            this.ir(IROp.JUMP_TRUE, { label: endLabel });
            this.ir(IROp.POP);
            this.lowerNode(node.right);
            this.placeLabel(endLabel);
            return;
        }
        this.lowerNode(node.left);
        this.lowerNode(node.right);
        const opMap = {
            [TokenType.PLUS]: IROp.ADD, '+': IROp.ADD, [TokenType.MINUS]: IROp.SUB, '-': IROp.SUB,
            [TokenType.STAR]: IROp.MUL, '*': IROp.MUL, [TokenType.SLASH]: IROp.DIV, '/': IROp.DIV,
            [TokenType.PERCENT]: IROp.MOD, '%': IROp.MOD, [TokenType.CARET]: IROp.POW, '^': IROp.POW,
            [TokenType.SLASHSLASH]: IROp.IDIV, '//': IROp.IDIV, [TokenType.EQ]: IROp.EQ, '==': IROp.EQ,
            [TokenType.NEQ]: IROp.NEQ, '~=': IROp.NEQ, [TokenType.LT]: IROp.LT, '<': IROp.LT,
            [TokenType.LTE]: IROp.LE, '<=': IROp.LE, [TokenType.GT]: IROp.GT, '>': IROp.GT,
            [TokenType.GTE]: IROp.GE, '>=': IROp.GE, [TokenType.DOTDOT]: IROp.CONCAT, '..': IROp.CONCAT,
            [TokenType.AMPERSAND]: IROp.BAND, '&': IROp.BAND, [TokenType.PIPE]: IROp.BOR, '|': IROp.BOR,
            [TokenType.TILDE]: IROp.BXOR, '~': IROp.BXOR, [TokenType.LSHIFT]: IROp.SHL, '<<': IROp.SHL,
            [TokenType.RSHIFT]: IROp.SHR, '>>': IROp.SHR
        };
        const irop = opMap[node.op];
        if (irop) this.ir(irop);
    }

    lower_UnaryOp(node) {
        this.lowerNode(node.operand);
        const opMap = { '-': IROp.NEGATE, 'not': IROp.NOT, '#': IROp.LEN, '~': IROp.BNOT };
        const irop = opMap[node.op];
        if (irop) this.ir(irop);
    }

    lower_Call(node) {
        this.lowerNode(node.func);
        for (const arg of node.args) this.lowerNode(arg);
        this.ir(IROp.CALL, { argc: node.args.length });
    }

    lower_MethodCall(node) {
        this.lowerNode(node.object);
        const idx = this.addConstant(node.method);
        this.ir(IROp.SELF_CALL, { constIdx: idx });
        for (const arg of node.args) this.lowerNode(arg);
        this.ir(IROp.CALL, { argc: node.args.length + 1 });
    }

    lower_MemberAccess(node) {
        this.lowerNode(node.object);
        const idx = this.addConstant(node.property);
        this.ir(IROp.LOAD_CONST, { constIdx: idx });
        this.ir(IROp.GET_TABLE);
    }

    lower_IndexAccess(node) {
        this.lowerNode(node.object);
        this.lowerNode(node.index);
        this.ir(IROp.GET_TABLE);
    }

    lower_Table(node) {
        this.ir(IROp.NEW_TABLE);
        let arrayIdx = 1;
        for (const field of node.fields) {
            this.ir(IROp.DUP);
            if (field.type === 'array') {
                const idx = this.addConstant(arrayIdx++);
                this.ir(IROp.LOAD_CONST, { constIdx: idx });
                this.lowerNode(field.value);
            } else if (field.type === 'named') {
                const idx = this.addConstant(field.key);
                this.ir(IROp.LOAD_CONST, { constIdx: idx });
                this.lowerNode(field.value);
            } else {
                this.lowerNode(field.key);
                this.lowerNode(field.value);
            }
            this.ir(IROp.SET_TABLE);
        }
    }

    lower_Vararg() { this.ir(IROp.VARARG); }
}

class BytecodeCompiler {
    constructor(vmArch, target) {
        this.vmArch = vmArch;
        this.target = target;
        this.features = LuaFeatures[target];
    }

    compile(irResult) {
        const mainBc = this._compileIR(irResult.instructions, irResult.constants);
        const compiledClosures = this._compileClosures(irResult.closures);
        const allConstants = this._mergeClosureConstants(irResult.constants, compiledClosures);
        return { bytecode: mainBc.bytecode, constants: allConstants };
    }

    _compileClosures(closures) {
        const results = [];
        for (const cl of closures) {
            const bc = this._compileIR(cl.ir, cl.constants);
            const subClosures = this._compileClosures(cl.closures);
            const mergedK = this._mergeClosureConstants(cl.constants, subClosures);
            results.push({ bytecode: bc.bytecode, constants: mergedK, params: cl.params, vararg: cl.vararg });
        }
        return results;
    }

    _mergeClosureConstants(constants, compiledClosures) {
        return constants.map(c => {
            if (typeof c === 'object' && c !== null && c._t === 'func') {
                const cl = compiledClosures[c._closureIdx];
                return { _t: 'func', _bc: cl.bytecode, _k: cl.constants, _p: cl.params, _va: cl.vararg };
            }
            return c;
        });
    }

    _compileIR(instructions, constants) {
        const bytecode = [];
        const config = this.vmArch.activeConfig;
        const labelPositions = {};
        const patchList = [];

        const emitByte = (b) => { bytecode.push(b & 0xFF); };
        const emitOp = (opName) => { emitByte(this.vmArch.getOpcode(opName)); };

        const encodeImmediate = (val) => {
            val = (val ^ config.immediateKey) >>> 0;
            return val;
        };

        const emitWord = (val) => {
            val = encodeImmediate(val);
            if (config.endianness === 'little') { emitByte(val & 0xFF); emitByte((val >> 8) & 0xFF); emitByte((val >> 16) & 0xFF); emitByte((val >> 24) & 0xFF); }
            else { emitByte((val >> 24) & 0xFF); emitByte((val >> 16) & 0xFF); emitByte((val >> 8) & 0xFF); emitByte(val & 0xFF); }
        };

        const emitJumpPlaceholder = () => {
            const pos = bytecode.length;
            emitByte(0); emitByte(0); emitByte(0); emitByte(0);
            return pos;
        };

        const patchJump = (pos, target) => {
            let val = target;
            if (config.jumpRelative) val = (target - pos - 4);
            val = (val ^ config.jumpKey) >>> 0;
            if (config.endianness === 'little') { bytecode[pos] = val & 0xFF; bytecode[pos + 1] = (val >> 8) & 0xFF; bytecode[pos + 2] = (val >> 16) & 0xFF; bytecode[pos + 3] = (val >> 24) & 0xFF; }
            else { bytecode[pos] = (val >> 24) & 0xFF; bytecode[pos + 1] = (val >> 16) & 0xFF; bytecode[pos + 2] = (val >> 8) & 0xFF; bytecode[pos + 3] = val & 0xFF; }
        };

        const irToVmOp = {
            [IROp.ADD]: 'ADD', [IROp.SUB]: 'SUB', [IROp.MUL]: 'MUL', [IROp.DIV]: 'DIV',
            [IROp.MOD]: 'MOD', [IROp.POW]: 'POW', [IROp.IDIV]: 'IDIV', [IROp.NEGATE]: 'UNM',
            [IROp.NOT]: 'NOT', [IROp.LEN]: 'LEN', [IROp.BNOT]: 'BNOT', [IROp.CONCAT]: 'CONCAT',
            [IROp.BAND]: 'BAND', [IROp.BOR]: 'BOR', [IROp.BXOR]: 'BXOR', [IROp.SHL]: 'SHL', [IROp.SHR]: 'SHR',
            [IROp.EQ]: 'EQ', [IROp.NEQ]: 'NEQ', [IROp.LT]: 'LT', [IROp.LE]: 'LE', [IROp.GT]: 'GT', [IROp.GE]: 'GE',
            [IROp.NEW_TABLE]: 'NEWTBL', [IROp.GET_TABLE]: 'GETTBL', [IROp.SET_TABLE]: 'SETTBL',
            [IROp.LOAD_NIL]: 'LDNIL', [IROp.LOAD_TRUE]: 'LDTRUE', [IROp.LOAD_FALSE]: 'LDFALSE',
            [IROp.DUP]: 'DUP', [IROp.POP]: 'POP', [IROp.SWAP]: 'SWAP', [IROp.ROT3]: 'ROT3',
            [IROp.NOP]: 'NOP', [IROp.HALT]: 'HALT', [IROp.VARARG]: 'VARG'
        };

        for (const inst of instructions) {
            if (inst.op === IROp.LABEL) { labelPositions[inst.name] = bytecode.length; continue; }
            if (inst.op === IROp.ENTER_SCOPE || inst.op === IROp.EXIT_SCOPE) continue;

            if (irToVmOp[inst.op]) { emitOp(irToVmOp[inst.op]); continue; }

            switch (inst.op) {
                case IROp.INIT_LOCAL:
                    emitOp('INITLOC'); emitByte(inst.index & 0xFF); break;
                case IROp.LOAD_CONST:
                    emitOp('LDK'); emitWord(inst.constIdx); break;
                case IROp.LOAD_LOCAL:
                    emitOp('LDLOC'); emitByte(inst.index & 0xFF); break;
                case IROp.STORE_LOCAL:
                    if (inst.fromTfor) { emitOp('STLOC'); emitByte(inst.index & 0xFF); }
                    else { emitOp('STLOC'); emitByte(inst.index & 0xFF); }
                    break;
                case IROp.LOAD_GLOBAL:
                    emitOp('LDGLOB'); emitWord(inst.constIdx); break;
                case IROp.STORE_GLOBAL:
                    emitOp('STGLOB'); emitWord(inst.constIdx); break;
                case IROp.LOAD_UPVALUE:
                    emitOp('LDUP'); emitByte(inst.index & 0xFF); break;
                case IROp.STORE_UPVALUE:
                    emitOp('STUP'); emitByte(inst.index & 0xFF); break;
                case IROp.JUMP: case IROp.JUMP_TRUE: case IROp.JUMP_FALSE: case IROp.JUMP_NIL: {
                    const jmpOps = { [IROp.JUMP]: 'JMP', [IROp.JUMP_TRUE]: config.invertConditionals ? 'JF' : 'JT', [IROp.JUMP_FALSE]: config.invertConditionals ? 'JT' : 'JF', [IROp.JUMP_NIL]: 'JNIL' };
                    emitOp(jmpOps[inst.op]);
                    const patchPos = emitJumpPlaceholder();
                    patchList.push({ pos: patchPos, label: inst.label });
                    break;
                }
                case IROp.FOR_LOOP:
                    emitOp('LOOP'); break;
                case IROp.TFOR_CALL:
                    emitOp('TFOR'); emitByte(inst.names & 0xFF);
                    emitByte(inst.iterIdx & 0xFF); emitByte(inst.stateIdx & 0xFF); emitByte(inst.controlIdx & 0xFF);
                    break;
                case IROp.CALL:
                    emitOp('CALL'); emitByte(inst.argc & 0xFF); break;
                case IROp.MRET:
                    emitOp('MRET'); emitByte(inst.count & 0xFF); break;
                case IROp.SELF_CALL:
                    emitOp('LDK'); emitWord(inst.constIdx); emitOp('SELF'); break;
                case IROp.RETURN:
                    emitOp('RET'); emitByte(inst.count & 0xFF); break;
                case IROp.CLOSURE:
                    emitOp('CLOS'); emitWord(inst.constIdx); break;
                case IROp.INTEGRITY_CHECK: {
                    const kindMap = { debug: 'CHKDBG', env: 'CHKENV', hook: 'ANTIHOOK', emu: 'CHKEMU', sandbox: 'CHKSBOX' };
                    emitOp(kindMap[inst.kind] || 'NOP');
                    break;
                }
                case IROp.TIMING_CHECK:
                    emitOp('CHKTIM'); break;
            }
        }

        for (const patch of patchList) {
            const target = labelPositions[patch.label];
            if (target !== undefined) patchJump(patch.pos, target);
        }

        return { bytecode };
    }
}

class CryptoSystem {
    constructor(buildConfig, sodium) {
        this.buildConfig = buildConfig;
        this.sodium = sodium;
        this.key = new Uint8Array(buildConfig.generateBytes(32));
        this.nonceSeed = new Uint8Array(buildConfig.generateBytes(12));
        this.nonceCounter = 0;
    }

    _rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

    _quarterRound(s, a, b, c, d) {
        s[a] = (s[a] + s[b]) >>> 0; s[d] = this._rotl32(s[d] ^ s[a], 16);
        s[c] = (s[c] + s[d]) >>> 0; s[b] = this._rotl32(s[b] ^ s[c], 12);
        s[a] = (s[a] + s[b]) >>> 0; s[d] = this._rotl32(s[d] ^ s[a], 8);
        s[c] = (s[c] + s[d]) >>> 0; s[b] = this._rotl32(s[b] ^ s[c], 7);
    }

    _chacha20Block(keyBytes, nonceBytes, counter) {
        const state = new Uint32Array(16);
        state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
        for (let i = 0; i < 8; i++) state[4 + i] = (keyBytes[i * 4]) | (keyBytes[i * 4 + 1] << 8) | (keyBytes[i * 4 + 2] << 16) | (keyBytes[i * 4 + 3] << 24);
        state[12] = counter >>> 0;
        for (let i = 0; i < 3; i++) state[13 + i] = (nonceBytes[i * 4]) | (nonceBytes[i * 4 + 1] << 8) | (nonceBytes[i * 4 + 2] << 16) | (nonceBytes[i * 4 + 3] << 24);
        const w = new Uint32Array(state);
        for (let i = 0; i < 10; i++) {
            this._quarterRound(w, 0, 4, 8, 12); this._quarterRound(w, 1, 5, 9, 13);
            this._quarterRound(w, 2, 6, 10, 14); this._quarterRound(w, 3, 7, 11, 15);
            this._quarterRound(w, 0, 5, 10, 15); this._quarterRound(w, 1, 6, 11, 12);
            this._quarterRound(w, 2, 7, 8, 13); this._quarterRound(w, 3, 4, 9, 14);
        }
        const bytes = [];
        for (let i = 0; i < 16; i++) { const v = (w[i] + state[i]) >>> 0; bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }
        return bytes;
    }

    _chacha20Encrypt(data, keyBytes, nonceBytes) {
        const result = [];
        let block = null;
        for (let i = 0; i < data.length; i++) {
            const bi = i % 64;
            if (bi === 0) block = this._chacha20Block(keyBytes, nonceBytes, Math.floor(i / 64));
            result.push((data[i] ^ block[bi]) & 0xFF);
        }
        return result;
    }

    _nextNonce(size) {
        const nonce = new Uint8Array(size);
        const counter = this.nonceCounter++;
        const salt = this.buildConfig.runtimeSalt();
        nonce[0] = (counter ^ salt) & 0xFF;
        nonce[1] = ((counter >> 8) ^ (salt >> 8)) & 0xFF;
        nonce[2] = ((counter >> 16) ^ (salt >> 16)) & 0xFF;
        nonce[3] = ((counter >> 24) ^ (salt >> 24)) & 0xFF;
        for (let i = 4; i < size; i++) nonce[i] = this.nonceSeed[i % this.nonceSeed.length] ^ ((salt >> ((i % 4) * 8)) & 0xFF);
        return nonce;
    }

    encrypt(data) {
        if (this.sodium) {
            const plaintext = new Uint8Array(data);
            const nonce = this._nextNonce(24);
            const ciphertext = this.sodium.crypto_secretbox_easy(plaintext, nonce, this.key);
            return { data: Array.from(ciphertext), nonce: Array.from(nonce), key: Array.from(this.key), method: 'xsalsa20poly1305' };
        }
        const nonce = this._nextNonce(12);
        const keyBytes = Array.from(this.key);
        const encrypted = this._chacha20Encrypt(data, keyBytes, Array.from(nonce));
        return { data: encrypted, key: keyBytes, nonce: Array.from(nonce), method: 'chacha20' };
    }

    encryptString(str) {
        const bytes = [];
        const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
        if (encoder) { const encoded = encoder.encode(str); for (let i = 0; i < encoded.length; i++) bytes.push(encoded[i]); }
        else {
            for (let i = 0; i < str.length; i++) {
                const cp = str.codePointAt(i);
                if (cp < 0x80) bytes.push(cp);
                else if (cp < 0x800) bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
                else if (cp < 0x10000) bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
                else { bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)); i++; }
            }
        }
        const realLen = bytes.length;
        bytes.unshift(realLen & 0xFF, (realLen >> 8) & 0xFF, (realLen >> 16) & 0xFF, (realLen >> 24) & 0xFF);
        const padTarget = Math.ceil((bytes.length) / 32) * 32 + this.buildConfig.seededRandomInt(0, 3) * 32;
        while (bytes.length < padTarget) bytes.push(this.buildConfig.seededRandomInt(0, 255));
        return this.encrypt(bytes);
    }

    encryptHandlers(handlerStr, keyBytes, opcode) {
        const data = [];
        for (let i = 0; i < handlerStr.length; i++) data.push(handlerStr.charCodeAt(i) & 0xFF);
        const nonce = new Uint8Array(12);
        const salt = this.buildConfig.runtimeSalt();
        nonce[0] = (opcode ^ salt) & 0xFF;
        nonce[1] = ((opcode >> 8) ^ (salt >> 8)) & 0xFF;
        for (let i = 2; i < 12; i++) nonce[i] = keyBytes[(i * 7 + opcode) % keyBytes.length] ^ ((salt >> ((i % 4) * 8)) & 0xFF);
        return { data: this._chacha20Encrypt(data, keyBytes, Array.from(nonce)), nonce: Array.from(nonce) };
    }
}

class IntegritySystem {
    constructor(buildConfig) {
        this.buildConfig = buildConfig;
        this.seed = buildConfig.generateKey(32);
        this.polyA = buildConfig.generateKey(32) | 1;
        this.polyB = buildConfig.generateKey(32);
        this.polyM = 0xFFFFFFFB;
        this.probeConstants = [];
        for (let i = 0; i < 8; i++) this.probeConstants.push(buildConfig.generateKey(32));
    }

    computeExpectedIntegrityModifier() {
        let modifier = 0;
        for (let i = 0; i < this.probeConstants.length; i++) modifier = (modifier ^ this.probeConstants[i]) >>> 0;
        return modifier;
    }

    maskHandlerKey(realKeyBytes) {
        const modifier = this.computeExpectedIntegrityModifier();
        const masked = [];
        for (let i = 0; i < realKeyBytes.length; i++) {
            const modByte = (modifier >>> ((i % 4) * 8)) & 0xFF;
            masked.push((realKeyBytes[i] ^ modByte) & 0xFF);
        }
        return masked;
    }

    computeChecksum(data) {
        let h1 = this.seed, h2 = this.seed ^ 0x6a09e667, h3 = this.seed ^ 0xbb67ae85, h4 = this.seed ^ 0x3c6ef372;
        const len = data.length;
        for (let i = 0; i < len; i += 16) {
            let k1 = (data[i] || 0) | ((data[i+1] || 0) << 8) | ((data[i+2] || 0) << 16) | ((data[i+3] || 0) << 24);
            let k2 = (data[i+4] || 0) | ((data[i+5] || 0) << 8) | ((data[i+6] || 0) << 16) | ((data[i+7] || 0) << 24);
            let k3 = (data[i+8] || 0) | ((data[i+9] || 0) << 8) | ((data[i+10] || 0) << 16) | ((data[i+11] || 0) << 24);
            let k4 = (data[i+12] || 0) | ((data[i+13] || 0) << 8) | ((data[i+14] || 0) << 16) | ((data[i+15] || 0) << 24);
            k1 = Math.imul(k1, 0x239b961b) >>> 0; k1 = ((k1 << 15) | (k1 >>> 17)) >>> 0; k1 = Math.imul(k1, 0xab0e9789) >>> 0; h1 ^= k1;
            h1 = ((h1 << 19) | (h1 >>> 13)) >>> 0; h1 = (h1 + h2) >>> 0; h1 = (Math.imul(h1, 5) + 0x561ccd1b) >>> 0;
            k2 = Math.imul(k2, 0xab0e9789) >>> 0; k2 = ((k2 << 16) | (k2 >>> 16)) >>> 0; k2 = Math.imul(k2, 0x38b34ae5) >>> 0; h2 ^= k2;
            h2 = ((h2 << 17) | (h2 >>> 15)) >>> 0; h2 = (h2 + h3) >>> 0; h2 = (Math.imul(h2, 5) + 0x0bcaa747) >>> 0;
            k3 = Math.imul(k3, 0x38b34ae5) >>> 0; k3 = ((k3 << 17) | (k3 >>> 15)) >>> 0; k3 = Math.imul(k3, 0xa1e38b93) >>> 0; h3 ^= k3;
            h3 = ((h3 << 15) | (h3 >>> 17)) >>> 0; h3 = (h3 + h4) >>> 0; h3 = (Math.imul(h3, 5) + 0x96cd1c35) >>> 0;
            k4 = Math.imul(k4, 0xa1e38b93) >>> 0; k4 = ((k4 << 18) | (k4 >>> 14)) >>> 0; k4 = Math.imul(k4, 0x239b961b) >>> 0; h4 ^= k4;
            h4 = ((h4 << 13) | (h4 >>> 19)) >>> 0; h4 = (h4 + h1) >>> 0; h4 = (Math.imul(h4, 5) + 0x32ac3b17) >>> 0;
        }
        h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
        h1 = (h1 + h2 + h3 + h4) >>> 0; h2 = (h2 + h1) >>> 0; h3 = (h3 + h1) >>> 0; h4 = (h4 + h1) >>> 0;
        h1 ^= h1 >>> 16; h1 = Math.imul(h1, 0x85ebca6b) >>> 0; h1 ^= h1 >>> 13; h1 = Math.imul(h1, 0xc2b2ae35) >>> 0; h1 ^= h1 >>> 16;
        h2 ^= h2 >>> 16; h2 = Math.imul(h2, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35) >>> 0; h2 ^= h2 >>> 16;
        h3 ^= h3 >>> 16; h3 = Math.imul(h3, 0x85ebca6b) >>> 0; h3 ^= h3 >>> 13; h3 = Math.imul(h3, 0xc2b2ae35) >>> 0; h3 ^= h3 >>> 16;
        h4 ^= h4 >>> 16; h4 = Math.imul(h4, 0x85ebca6b) >>> 0; h4 ^= h4 >>> 13; h4 = Math.imul(h4, 0xc2b2ae35) >>> 0; h4 ^= h4 >>> 16;
        return { h1: h1 >>> 0, h2: h2 >>> 0, h3: h3 >>> 0, h4: h4 >>> 0 };
    }

    generateAntiDebug() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_t0=os.clock and os.clock() or 0`);
        lines.push(`local ${v}_dbg=false`);
        lines.push(`if debug and debug.getinfo then local i=debug.getinfo(1) if i and i.what=="C" then ${v}_dbg=true end end`);
        lines.push(`if debug and debug.sethook then local h=debug.gethook and debug.gethook() if h then ${v}_dbg=true end end`);
        lines.push(`if _G.jit and _G.jit.status and not _G.jit.status() then ${v}_dbg=true end`);
        lines.push(`local function ${v}_tck() local t=os.clock and os.clock() or 0 if t-${v}_t0>0.1 then return false end ${v}_t0=t return true end`);
        this._antiDebugVar = `${v}_dbg`;
        this._tickFn = `${v}_tck`;
        return lines.join('\n');
    }

    generateEnvCheck() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_env={}`);
        lines.push(`local ${v}_efn={"print","pairs","ipairs","next","type","tostring","tonumber","select","rawget","rawset","rawequal","getmetatable","setmetatable","pcall","xpcall","error","assert","loadstring","load","dofile","loadfile","require","module","unpack","table","string","math","coroutine","io","os","debug","package"}`);
        lines.push(`for _,k in ipairs(${v}_efn) do if _G[k] then ${v}_env[k]=tostring(_G[k]) end end`);
        lines.push(`local function ${v}_venv() for k,v in pairs(${v}_env) do if not _G[k] or tostring(_G[k])~=v then return false end end return true end`);
        this._envCheckFn = `${v}_venv`;
        return lines.join('\n');
    }

    generateHookDetection() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_mts={}`);
        lines.push(`local ${v}_tbs={string=string,table=table,math=math}`);
        lines.push(`for n,t in pairs(${v}_tbs) do local mt=getmetatable(t) ${v}_mts[n]=mt and tostring(mt) or "nil" end`);
        lines.push(`local function ${v}_vhk()`);
        lines.push(`for n,t in pairs(${v}_tbs) do local mt=getmetatable(t) local s=mt and tostring(mt) or "nil" if s~=${v}_mts[n] then return false end end`);
        lines.push(`if debug and debug.getmetatable then for n,t in pairs(${v}_tbs) do local mt=debug.getmetatable(t) if mt and not ${v}_mts[n]:find("nil") then return false end end end`);
        lines.push(`return true end`);
        this._hookCheckFn = `${v}_vhk`;
        return lines.join('\n');
    }

    generateAntiEmulation() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_emu=false`);
        lines.push(`local function ${v}_chkemu()`);
        lines.push(`if os.getenv then`);
        lines.push(`local ev={"QEMU_AUDIO_DRV","DOCKER_HOST","container","KUBERNETES_SERVICE_HOST","WINE","WINEPREFIX","WINEDEBUG","WINELOADER","SANDBOX","SANDBOXIE","CUCKOO"}`);
        lines.push(`for _,e in ipairs(ev) do if os.getenv(e) then return true end end`);
        lines.push(`end`);
        lines.push(`if io and io.open then`);
        lines.push(`local vf={"/.dockerenv","/proc/1/cgroup","/proc/self/status","/.flatpak-info"}`);
        lines.push(`for _,f in ipairs(vf) do local h=io.open(f,"r") if h then local c=h:read("*a") or "" h:close()`);
        lines.push(`if c:find("docker") or c:find("lxc") or c:find("kubepods") or c:find("qemu") or c:find("kvm") or c:find("vbox") or c:find("vmware") or c:find("hyperv") then return true end end end`);
        lines.push(`end`);
        lines.push(`if os.execute then local r=os.execute("grep -q hypervisor /proc/cpuinfo 2>/dev/null") if r==true or r==0 then return true end end`);
        lines.push(`return false end`);
        lines.push(`${v}_emu=${v}_chkemu()`);
        this._emuVar = `${v}_emu`;
        return lines.join('\n');
    }

    generateSandboxDetection() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_sbox=false`);
        lines.push(`local function ${v}_chksbox()`);
        lines.push(`local start=os.clock and os.clock() or 0`);
        lines.push(`local sum=0 for i=1,500000 do sum=sum+i end`);
        lines.push(`local elapsed=os.clock and (os.clock()-start) or 0`);
        lines.push(`if elapsed>0.5 then return true end`);
        lines.push(`if elapsed<0.001 and sum>0 then return true end`);
        lines.push(`local m1=collectgarbage("count")`);
        lines.push(`local t={} for i=1,10000 do t[i]=string.rep("x",100) end`);
        lines.push(`local m2=collectgarbage("count") t=nil collectgarbage("collect")`);
        lines.push(`if (m2-m1)<100 then return true end`);
        lines.push(`if debug and debug.getinfo then local info=debug.getinfo(1) if info and info.source and info.source:find("sandbox") then return true end end`);
        lines.push(`if os.getenv then`);
        lines.push(`local se={"ANALYSIS","MALWARE","VIRUS","SANDBOX","CUCKOO","ANUBIS","THREAT","JOEBOX"}`);
        lines.push(`for _,e in ipairs(se) do for k,vl in pairs(os.getenv() or {}) do if type(k)=="string" and k:upper():find(e) then return true end end end`);
        lines.push(`end`);
        lines.push(`return false end`);
        lines.push(`${v}_sbox=${v}_chksbox()`);
        this._sboxVar = `${v}_sbox`;
        return lines.join('\n');
    }

    generateTimingCheck() {
        const v = this.buildConfig.generateId(4);
        const lines = [];
        lines.push(`local ${v}_tok=true`);
        lines.push(`local function ${v}_chkt()`);
        lines.push(`local samples={} for i=1,5 do local t1=os.clock and os.clock() or 0 local x=0 for j=1,10000 do x=x+j end`);
        lines.push(`local t2=os.clock and os.clock() or 0 samples[i]=t2-t1 end`);
        lines.push(`local avg=0 for i=1,5 do avg=avg+samples[i] end avg=avg/5`);
        lines.push(`local variance=0 for i=1,5 do variance=variance+(samples[i]-avg)^2 end variance=variance/5`);
        lines.push(`if variance>avg*10 then return false end`);
        lines.push(`if avg>0.1 then return false end`);
        lines.push(`return true end`);
        lines.push(`${v}_tok=${v}_chkt()`);
        this._timingVar = `${v}_tok`;
        return lines.join('\n');
    }

    generateIntegrityKeyDerivation(maskedKeyBytes) {
        const v = this.buildConfig.generateId(4);
        const probes = [
            { check: 'type(print)=="function"', pc: this.probeConstants[0] },
            { check: 'type(pairs)=="function"', pc: this.probeConstants[1] },
            { check: 'type(tostring)=="function"', pc: this.probeConstants[2] },
            { check: 'type(tonumber)=="function"', pc: this.probeConstants[3] },
            { check: 'type(math)=="table"', pc: this.probeConstants[4] },
            { check: 'type(string)=="table"', pc: this.probeConstants[5] },
            { check: 'type(table)=="table"', pc: this.probeConstants[6] },
            { check: 'type(coroutine)=="table"', pc: this.probeConstants[7] }
        ];
        const lines = [];
        lines.push(`local ${v}_hke={${maskedKeyBytes.join(',')}}`);
        lines.push(`local ${v}_ikm=0`);
        for (const p of probes) lines.push(`if ${p.check} then ${v}_ikm=bit_xor(${v}_ikm,${p.pc}) end`);
        lines.push(`local ${v}_hkd={}`);
        lines.push(`for i=1,#${v}_hke do local mb=bit_and(bit_rshift(${v}_ikm,((i-1)%4)*8),0xFF) ${v}_hkd[i]=bit_xor(${v}_hke[i],mb) end`);
        this._derivedKeyVar = `${v}_hkd`;
        return lines.join('\n');
    }

    getGuardCondition() {
        return `not ${this._antiDebugVar} and not ${this._emuVar} and not ${this._sboxVar} and ${this._timingVar} and ${this._envCheckFn}() and ${this._hookCheckFn}()`;
    }
}

class VMArchitect {
    constructor(buildConfig, target) {
        this.buildConfig = buildConfig;
        this.target = target;
        this.features = LuaFeatures[target];
        this.selectedVM = this.buildConfig.seededRandomInt(0, 11);
        this.vmConfigs = this.generateVMConfigs();
        this.activeConfig = this.vmConfigs[this.selectedVM];
        this.generateOpcodeLayout();
    }

    generateVMConfigs() {
        const configs = [];
        const archetypes = [
            { name: 'STACK_LE', style: 'stack' }, { name: 'STACK_BE', style: 'stack' },
            { name: 'ACCUM_A', style: 'accumulator' }, { name: 'REG4_LE', style: 'register' },
            { name: 'REG8_BE', style: 'register' }, { name: 'HYBRID4', style: 'hybrid' },
            { name: 'HYBRID8', style: 'hybrid' }, { name: 'THREADED', style: 'threaded' },
            { name: 'SWITCHED', style: 'switched' }, { name: 'DUALSTK', style: 'dual_stack' },
            { name: 'TAGGED', style: 'tagged' }, { name: 'COMPACT', style: 'compact' }
        ];
        for (let i = 0; i < 12; i++) {
            const arch = archetypes[i];
            configs.push({
                id: i, name: arch.name, style: arch.style,
                key: this.buildConfig.generateKey(32),
                nonce: this.buildConfig.generateBytes(24),
                opcodeOffset: this.buildConfig.seededRandomInt(0, 127),
                endianness: this.buildConfig.seededRandomInt(0, 1) === 0 ? 'little' : 'big',
                wordSize: 4,
                dispatchStyle: ['switch', 'table', 'computed'][this.buildConfig.seededRandomInt(0, 2)],
                handlerKey: this.buildConfig.generateKey(32),
                handlerNonce: this.buildConfig.generateBytes(16),
                immediateKey: this.buildConfig.generateKey(32),
                jumpKey: this.buildConfig.generateKey(32),
                jumpRelative: this.buildConfig.seededRandom() > 0.5,
                invertConditionals: this.buildConfig.seededRandom() > 0.5,
                popOrderSwap: this.buildConfig.seededRandom() > 0.5,
                addTransform: this.buildConfig.seededRandomInt(0, 3),
                subTransform: this.buildConfig.seededRandomInt(0, 3),
                mulTransform: this.buildConfig.seededRandomInt(0, 2),
                addMask: this.buildConfig.generateKey(16) & 0xFFFF,
                xorSeed: this.buildConfig.generateKey(32),
                stackDirection: this.buildConfig.seededRandomInt(0, 1) === 0 ? 'up' : 'down',
                callConvention: ['stack', 'reversed'][this.buildConfig.seededRandomInt(0, 1)],
                rekeyInterval: this.buildConfig.seededRandomInt(8, 32),
                selfModifyRate: this.buildConfig.seededRandom() * 0.3 + 0.1,
                oneshotOpcodes: this.buildConfig.shuffleArray([0,1,2,3,4,5,6,7]).slice(0, this.buildConfig.seededRandomInt(2, 5)),
                smXorMask: this.buildConfig.seededRandomInt(1, 255)
            });
        }
        return configs;
    }

    generateOpcodeLayout() {
        this.opcodeMap = {};
        this.reverseMap = {};
        const allOps = [
            'ADD','SUB','MUL','DIV','MOD','POW','IDIV','UNM',
            'PUSH','POP','DUP','SWAP','ROT3','PICK','DROP',
            'JMP','JT','JF','JNIL','LOOP','TFOR',
            'LDLOC','STLOC','LDGLOB','STGLOB','LDUP','STUP','NEWTBL','GETTBL','SETTBL',
            'CALL','TCALL','RET','CLOS','SELF','MRET',
            'INITLOC',
            'EQ','NEQ','LT','LE','GT','GE',
            'BAND','BOR','BXOR','BNOT','SHL','SHR',
            'LDK','LDNIL','LDTRUE','LDFALSE','LEN','CONCAT','NOP','HALT','VARG','NOT',
            'CHKDBG','CHKTIM','CHKENV','ANTIHOOK','CHKEMU','CHKSBOX',
            'REKEY','SMBC','TRAP'
        ];
        const allOpcodes = [];
        for (let i = 0; i < 256; i++) allOpcodes.push(i);
        const shuffled = this.buildConfig.shuffleArray(allOpcodes);
        const shuffledOps = this.buildConfig.shuffleArray([...allOps]);
        for (let i = 0; i < shuffledOps.length; i++) {
            const op = shuffledOps[i];
            const opcode = (shuffled[i] + this.activeConfig.opcodeOffset) & 0xFF;
            this.opcodeMap[op] = { code: opcode };
            this.reverseMap[opcode] = { op };
        }
        this.fakeOpcodes = [];
        for (let i = shuffledOps.length; i < shuffledOps.length + 40; i++) {
            const opcode = (shuffled[i % 256] + this.activeConfig.opcodeOffset) & 0xFF;
            if (!this.reverseMap[opcode]) {
                this.reverseMap[opcode] = { op: 'TRAP' };
                this.fakeOpcodes.push(opcode);
            }
        }
    }

    getOpcode(op) { return this.opcodeMap[op]?.code ?? 0; }

    getSemanticConfig() {
        const c = this.activeConfig;
        return {
            immediateKey: c.immediateKey, jumpKey: c.jumpKey, jumpRelative: c.jumpRelative,
            invertConditionals: c.invertConditionals, popOrderSwap: c.popOrderSwap,
            addTransform: c.addTransform, subTransform: c.subTransform, mulTransform: c.mulTransform,
            addMask: c.addMask, xorSeed: c.xorSeed, stackDirection: c.stackDirection,
            callConvention: c.callConvention, wordSize: c.wordSize, endianness: c.endianness,
            rekeyInterval: c.rekeyInterval, selfModifyRate: c.selfModifyRate,
            oneshotOpcodes: c.oneshotOpcodes, smXorMask: c.smXorMask
        };
    }
}

class ControlFlowObfuscator {
    constructor(buildConfig) { this.buildConfig = buildConfig; this.blockCounter = 0; }

    generateOpaquePredicateRuntime(count) {
        const preds = [];
        for (let i = 0; i < count; i++) {
            const a = this.buildConfig.seededRandomInt(2, 200);
            const b = this.buildConfig.seededRandomInt(2, 200);
            const c = a + b;
            const kind = this.buildConfig.seededRandomInt(0, 6);
            let expr;
            switch (kind) {
                case 0: expr = `((${a}*${a}+${b}*${b})%${c}==${(a*a+b*b)%c})`; break;
                case 1: expr = `(${a}*${b}%2==${(a*b)%2})`; break;
                case 2: expr = `(bit_and(${a},1)==${a&1})`; break;
                case 3: expr = `(${a}+${b}>${Math.min(a,b)})`; break;
                case 4: { const v = this.buildConfig.generateId(3); expr = `(function() local ${v}={} for ${v}k=1,${this.buildConfig.seededRandomInt(3,7)} do ${v}[${v}k]=${v}k end return #${v}>${0} end)()`; break; }
                case 5: { const x = this.buildConfig.seededRandomInt(10, 99); expr = `(tostring(${x}):len()==${x.toString().length})`; break; }
                case 6: { const x = this.buildConfig.seededRandomInt(1, 50); expr = `(type(${x})=="number")`; break; }
            }
            preds.push({ expr, result: true, id: `_op${this.buildConfig.generateId(3)}` });
        }
        return preds;
    }

    generateOpaquePredicateLua(preds) { return preds.map(p => `local ${p.id}=${p.expr}`).join('\n'); }

    generateOpaqueGuard(preds) {
        if (preds.length === 0) return 'true';
        const count = Math.min(3, preds.length);
        const indices = this.buildConfig.shuffleArray([...Array(preds.length).keys()]).slice(0, count);
        return indices.map(i => preds[i].result ? preds[i].id : `not ${preds[i].id}`).join(' and ');
    }

    generateDeadHandlerCode(buildConfig) {
        const patterns = [];
        const count = buildConfig.seededRandomInt(2, 6);
        for (let i = 0; i < count; i++) {
            const k = buildConfig.seededRandomInt(0, 4);
            const v = buildConfig.generateId(3);
            switch (k) {
                case 0: patterns.push(`local ${v}=nil`); break;
                case 1: patterns.push(`local ${v}=${buildConfig.seededRandomInt(0,999)}`); break;
                case 2: patterns.push(`local ${v}=true if not ${v} then error() end`); break;
                case 3: patterns.push(`local ${v}={} ${v}[1]=${buildConfig.seededRandomInt(0,999)} ${v}=nil`); break;
                case 4: patterns.push(`local ${v}=tostring(${buildConfig.seededRandomInt(0,9999)})`); break;
            }
        }
        return patterns.join(' ');
    }

    generateFakeHandler(buildConfig) {
        const v = buildConfig.generateId(4);
        const kind = buildConfig.seededRandomInt(0, 3);
        switch (kind) {
            case 0: return `return function(s) local ${v}=s:pop() s:push(${v}) s:push(nil) s:pop() end`;
            case 1: return `return function(s) local ${v}=${buildConfig.seededRandomInt(0,255)} s:push(${v}) s:pop() end`;
            case 2: return `return function(s) local ${v}=s._stk local ${v}2=#${v} end`;
            case 3: return `return function(s) local ${v}=s._pc s._pc=s._pc end`;
        }
        return `return function(s) end`;
    }
}

class VMObfuscator {
    constructor(buildConfig, vmArch, target, integritySystem, cryptoSystem, cfObfuscator) {
        this.buildConfig = buildConfig;
        this.vmArch = vmArch;
        this.target = target;
        this.features = LuaFeatures[target];
        this.integritySystem = integritySystem;
        this.cryptoSystem = cryptoSystem;
        this.cfObfuscator = cfObfuscator;
        this.varCounter = 0;
        this.handlerKeyBytes = buildConfig.generateBytes(32);
    }

    genVar(prefix = 'v') { return `_${prefix}${(this.varCounter++).toString(36)}`; }

    generateBitLib() {
        if (this.features.bitLib === 'native') {
            return `local bit_and=function(a,b) return a & b end\nlocal bit_or=function(a,b) return a | b end\nlocal bit_xor=function(a,b) return a ~ b end\nlocal bit_not=function(a) return ~a end\nlocal bit_lshift=function(a,b) return a << b end\nlocal bit_rshift=function(a,b) return a >> b end`;
        } else if (this.features.bitLib === 'bit32') {
            return `local bit_and=bit32.band local bit_or=bit32.bor local bit_xor=bit32.bxor local bit_not=bit32.bnot local bit_lshift=bit32.lshift local bit_rshift=bit32.rshift`;
        }
        return `local bit=require("bit") local bit_and=bit.band local bit_or=bit.bor local bit_xor=bit.bxor local bit_not=bit.bnot local bit_lshift=bit.lshift local bit_rshift=bit.rshift`;
    }

    generateTableUnpack() { return this.features.hasTableUnpack ? `local unpack=table.unpack or unpack` : `local unpack=unpack`; }

    encryptBytecode(bytecode) { return this.cryptoSystem.encrypt(bytecode); }

    encryptConstants(constants) {
        return constants.map(c => {
            if (typeof c === 'string') {
                const enc = this.cryptoSystem.encryptString(c);
                return { t: 's', d: enc.data, k: enc.key, n: enc.nonce };
            } else if (typeof c === 'number' && Number.isInteger(c)) {
                const bytes = [(c >>> 0) & 0xFF, (c >>> 8) & 0xFF, (c >>> 16) & 0xFF, (c >>> 24) & 0xFF];
                const enc = this.cryptoSystem.encrypt(bytes);
                return { t: 'i', d: enc.data, k: enc.key, n: enc.nonce };
            } else if (typeof c === 'number') {
                return { t: 'n', v: c };
            } else if (typeof c === 'object' && c !== null && c._t === 'func') {
                const encFunc = this.encryptBytecode(c._bc);
                return { t: 'f', bc: encFunc.data, bk: encFunc.key, bn: encFunc.nonce, k: this.encryptConstants(c._k), p: c._p, va: c._va ? 1 : 0 };
            }
            return { t: 'r', v: c };
        });
    }

    generateDecryptionRuntime(method) {
        const chacha20Lua = `local function _rotl(x,n) x=bit_and(x,0xFFFFFFFF) return bit_or(bit_lshift(x,n),bit_rshift(x,32-n)) end
local function _qr(s,a,b,c,d) s[a]=bit_and(s[a]+s[b],0xFFFFFFFF) s[d]=_rotl(bit_xor(s[d],s[a]),16) s[c]=bit_and(s[c]+s[d],0xFFFFFFFF) s[b]=_rotl(bit_xor(s[b],s[c]),12) s[a]=bit_and(s[a]+s[b],0xFFFFFFFF) s[d]=_rotl(bit_xor(s[d],s[a]),8) s[c]=bit_and(s[c]+s[d],0xFFFFFFFF) s[b]=_rotl(bit_xor(s[b],s[c]),7) end
local function _cc20(kw,nw,ctr) local s={0x61707865,0x3320646e,0x79622d32,0x6b206574,kw[1],kw[2],kw[3],kw[4],kw[5],kw[6],kw[7],kw[8],ctr,nw[1],nw[2],nw[3]} local w={} for i=1,16 do w[i]=s[i] end for _=1,10 do _qr(w,1,5,9,13) _qr(w,2,6,10,14) _qr(w,3,7,11,15) _qr(w,4,8,12,16) _qr(w,1,6,11,16) _qr(w,2,7,12,13) _qr(w,3,8,9,14) _qr(w,4,5,10,15) end local b={} for i=1,16 do local v=bit_and(w[i]+s[i],0xFFFFFFFF) b[#b+1]=bit_and(v,0xFF) b[#b+1]=bit_and(bit_rshift(v,8),0xFF) b[#b+1]=bit_and(bit_rshift(v,16),0xFF) b[#b+1]=bit_and(bit_rshift(v,24),0xFF) end return b end
local function _b2w(b) local w={} for i=1,math.floor(#b/4) do w[i]=bit_or(bit_or(bit_or(b[(i-1)*4+1] or 0,bit_lshift(b[(i-1)*4+2] or 0,8)),bit_lshift(b[(i-1)*4+3] or 0,16)),bit_lshift(b[(i-1)*4+4] or 0,24)) end return w end
local function _dec(d,k,n) local kw=_b2w(k) local nw=_b2w(n) local r={} local blk for i=1,#d do local bi=(i-1)%64 if bi==0 then blk=_cc20(kw,nw,math.floor((i-1)/64)) end r[i]=bit_xor(d[i],blk[bi+1]) end return r end`;
        if (method === 'xsalsa20poly1305') {
            return `local _sodium_ok,_sodium_lib=pcall(function() return require("sodium") end)\nlocal _sodium_rt=_sodium_ok and _sodium_lib or nil\nlocal function _dec_sodium(d,k,n) if _sodium_rt and _sodium_rt.crypto_secretbox_open_easy then return {_sodium_rt.crypto_secretbox_open_easy(string.char(unpack(d)),string.char(unpack(n)),string.char(unpack(k))):byte(1,-1)} end error("sodium required") end\n${chacha20Lua}`;
        }
        return chacha20Lua;
    }

    generateHandlerDecryptor() {
        const dkv = this.integritySystem._derivedKeyVar;
        return `local _HK0={} for i=1,#${dkv} do _HK0[i]=${dkv}[i] end\nlocal function _dh(e,ek) local r=_dec(e.d,_HK0,e.n) local s="" for i=1,#r do s=s..string.char(r[i]) end return load(s)() end`;
    }

    getHandlerCode(op, rw, config) {
        const sc = config;
        const immKey = sc.immediateKey;
        const jmpKey = sc.jumpKey;
        const jmpRel = sc.jumpRelative;
        const popSwap = sc.popOrderSwap;

        const readJump = jmpRel
            ? `(function() local _off=${rw} _off=bit_xor(_off,${jmpKey}) return s._pc+_off end)()`
            : `bit_xor(${rw},${jmpKey})`;

        const readImm = `bit_xor(${rw},${immKey})`;

        const binPop = popSwap ? `local a,b=s:pop(),s:pop()` : `local b,a=s:pop(),s:pop()`;

        const handlers = {
            'ADD': (() => {
                switch (sc.addTransform) {
                    case 0: return `${binPop} s:push(a+b)`;
                    case 1: return `${binPop} s:push(bit_xor(bit_xor(a,${sc.xorSeed})+bit_xor(b,${sc.xorSeed}),${sc.xorSeed}))`;
                    case 2: return `${binPop} local _r=a+b s:push(_r)`;
                    default: return `${binPop} s:push(a+b)`;
                }
            })(),
            'SUB': (() => {
                switch (sc.subTransform) {
                    case 0: return `${binPop} s:push(a-b)`;
                    case 1: return `${binPop} s:push(a+(-b))`;
                    case 2: return `${binPop} local _r=a-b s:push(_r)`;
                    default: return `${binPop} s:push(a-b)`;
                }
            })(),
            'MUL': (() => {
                switch (sc.mulTransform) {
                    case 0: return `${binPop} s:push(a*b)`;
                    case 1: return `${binPop} local _r=a*b s:push(_r)`;
                    default: return `${binPop} s:push(a*b)`;
                }
            })(),
            'DIV': `${binPop} s:push(a/b)`,
            'MOD': `${binPop} s:push(a%b)`,
            'POW': `${binPop} s:push(a^b)`,
            'IDIV': `${binPop} s:push(math.floor(a/b))`,
            'UNM': `s:push(-s:pop())`,
            'POP': `s:pop()`,
            'DUP': `s:push(s:peek())`,
            'SWAP': `local b,a=s:pop(),s:pop() s:push(b) s:push(a)`,
            'ROT3': `local c,b,a=s:pop(),s:pop(),s:pop() s:push(b) s:push(c) s:push(a)`,
            'PICK': `local n=s:r8() s:push(s._stk[#s._stk-n])`,
            'DROP': `local n=s:r8() for i=1,n do s:pop() end`,
            'JMP': `s._pc=${readJump}`,
            'JT': `local _t=${readJump} if s:pop() then s._pc=_t end`,
            'JF': `local _t=${readJump} if not s:pop() then s._pc=_t end`,
            'JNIL': `local _t=${readJump} if s:peek()==nil then s._pc=_t end`,
            'LOOP': `local st,lim,v=s:pop(),s:pop(),s:pop() s:push((st>0 and v<=lim) or (st<0 and v>=lim) or (st==0))`,
            'TFOR': `local _n=s:r8() local _ii=s:r8() local _si=s:r8() local _ci=s:r8() local _iter=s._L[_ii] and s._L[_ii].v or nil local _state=s._L[_si] and s._L[_si].v or nil local _ctl=s._L[_ci] and s._L[_ci].v or nil local _res={_iter(_state,_ctl)} for _i=1,_n do if not s._L[_ci+_i] then s._L[_ci+_i]={v=nil} end s._L[_ci+_i].v=_res[_i] end if s._L[_ci] then s._L[_ci].v=_res[1] end`,
            'INITLOC': `local _i=s:r8() if not s._L[_i] then s._L[_i]={v=nil} end`,
            'LDLOC': `local _i=s:r8() local _c=s._L[_i] s:push(_c and _c.v or nil)`,
            'STLOC': `local _i=s:r8() if not s._L[_i] then s._L[_i]={v=nil} end s._L[_i].v=s:pop()`,
            'LDGLOB': `s:push(s._G[s._K[${readImm}]])`,
            'STGLOB': `s._G[s._K[${readImm}]]=s:pop()`,
            'LDUP': `local _i=s:r8() local _c=s._U and s._U[_i] s:push(_c and _c.v or nil)`,
            'STUP': `local _i=s:r8() if s._U and s._U[_i] then s._U[_i].v=s:pop() else s:pop() end`,
            'NEWTBL': `s:push({})`,
            'GETTBL': `local k,t=s:pop(),s:pop() s:push(t[k])`,
            'SETTBL': `local v,k,t=s:pop(),s:pop(),s:pop() t[k]=v`,
            'CALL': (() => {
                if (sc.callConvention === 'reversed') {
                    return `local n=s:r8() local args={} for i=n,1,-1 do args[i]=s:pop() end local f=s:pop() local ok,res=true,nil ok,res=pcall(function() return {f(unpack(args,1,n))} end) if ok and res then for i=1,#res do s:push(res[i]) end s:push(#res) else s:push(nil) s:push(1) end`;
                }
                return `local n=s:r8() local args={} for i=n,1,-1 do args[i]=s:pop() end local f=s:pop() local res={f(unpack(args,1,n))} for i=1,#res do s:push(res[i]) end s:push(#res)`;
            })(),
            'MRET': `local want=s:r8() local got=s:pop() or 0 if got<want then for _mi=1,want-got do s:push(nil) end elseif got>want then for _mi=1,got-want do local _t=s._stk[#s._stk-want] s._stk[#s._stk-want]=nil end end`,
            'TCALL': `local n=s:r8() local args={} for i=n,1,-1 do args[i]=s:pop() end local f=s:pop() return f(unpack(args,1,n))`,
            'RET': `local n=s:r8() local res={} for i=n,1,-1 do res[i]=s:pop() end s._run=false return unpack(res,1,n)`,
            'CLOS': (() => {
                return `local fi=${readImm} local fd=s._K[fi] local _pL=s._L s:push(function(...) local _nvm=s._vm.new(fd._bc,fd._bk,fd._bn,fd._k) _nvm._U={} for _ck,_cv in pairs(_pL) do _nvm._U[_ck]=_cv end local _a={...} local _ac=select("#",...) for _ai=1,fd._p do if not _nvm._L[_ai-1] then _nvm._L[_ai-1]={v=nil} end _nvm._L[_ai-1].v=_a[_ai] end if fd._va==1 then _nvm._va={} for _vi=fd._p+1,_ac do _nvm._va[_vi-fd._p]=_a[_vi] end end return _nvm:run() end)`;
            })(),
            'SELF': `local k,t=s:pop(),s:peek() s:push(t[k])`,
            'EQ': `${binPop} s:push(a==b)`,
            'NEQ': `${binPop} s:push(a~=b)`,
            'LT': `${binPop} s:push(a<b)`,
            'LE': `${binPop} s:push(a<=b)`,
            'GT': `${binPop} s:push(a>b)`,
            'GE': `${binPop} s:push(a>=b)`,
            'BAND': `${binPop} s:push(bit_and(a,b))`,
            'BOR': `${binPop} s:push(bit_or(a,b))`,
            'BXOR': `${binPop} s:push(bit_xor(a,b))`,
            'BNOT': `s:push(bit_not(s:pop()))`,
            'SHL': `${binPop} s:push(bit_lshift(a,b))`,
            'SHR': `${binPop} s:push(bit_rshift(a,b))`,
            'LDK': `s:push(s._K[${readImm}])`,
            'LDNIL': `s:push(nil)`,
            'LDTRUE': `s:push(true)`,
            'LDFALSE': `s:push(false)`,
            'LEN': `s:push(#s:pop())`,
            'CONCAT': `${binPop} s:push(tostring(a)..tostring(b))`,
            'NOP': ``,
            'HALT': `s._run=false`,
            'VARG': `if s._va then for _vi=1,#s._va do s:push(s._va[_vi]) end else s:push(nil) end`,
            'NOT': `s:push(not s:pop())`,
            'CHKDBG': `if ${this.integritySystem._antiDebugVar} then s._run=false end`,
            'CHKTIM': `if not ${this.integritySystem._tickFn}() then s._run=false end`,
            'CHKENV': `if not ${this.integritySystem._envCheckFn}() then s._run=false end`,
            'ANTIHOOK': `if not ${this.integritySystem._hookCheckFn}() then s._run=false end`,
            'CHKEMU': `if ${this.integritySystem._emuVar} then s._run=false end`,
            'CHKSBOX': `if ${this.integritySystem._sboxVar} or not ${this.integritySystem._timingVar} then s._run=false end`,
            'REKEY': `s._rkc=(s._rkc or 0)+1`,
            'SMBC': `local _si=s:r8() local _sv=s:r8() local _sn=s:r8() for _sj=0,_sn-1 do if s._C[_si+_sj] then s._C[_si+_sj]=bit_xor(s._C[_si+_sj],_sv) end end`,
            'TRAP': `s._run=false`
        };
        return handlers[op] || ``;
    }

    generateEncryptedHandlers() {
        const config = this.vmArch.activeConfig;
        const sc = this.vmArch.getSemanticConfig();
        const allOps = Object.keys(this.vmArch.opcodeMap);
        const le = config.endianness === 'little';
        const rw = le ? `s:r8()+s:r8()*256+s:r8()*65536+s:r8()*16777216` : `s:r8()*16777216+s:r8()*65536+s:r8()*256+s:r8()`;

        const handlerCode = {};
        for (const op of allOps) {
            const opcode = this.vmArch.opcodeMap[op].code;
            const code = this.getHandlerCode(op, rw, sc);
            const deadCode = this.cfObfuscator.generateDeadHandlerCode(this.buildConfig);
            const wrapCode = this.buildConfig.seededRandom() > 0.6 ? `${deadCode} ${code}` : code;
            handlerCode[opcode] = wrapCode;
        }

        const encryptedHandlers = {};
        for (const [opcode, code] of Object.entries(handlerCode)) {
            const funcStr = `return function(s) ${code} end`;
            const encrypted = this.cryptoSystem.encryptHandlers(funcStr, this.handlerKeyBytes, parseInt(opcode));
            encryptedHandlers[opcode] = encrypted;
        }

        for (const fakeOp of this.vmArch.fakeOpcodes.slice(0, this.buildConfig.seededRandomInt(5, 15))) {
            const fakeCode = this.cfObfuscator.generateFakeHandler(this.buildConfig);
            const encrypted = this.cryptoSystem.encryptHandlers(fakeCode, this.handlerKeyBytes, fakeOp);
            encryptedHandlers[fakeOp] = encrypted;
        }

        return encryptedHandlers;
    }

    generateRekeyRuntime(config) {
        const interval = config.rekeyInterval;
        const v = this.buildConfig.generateId(4);
        return `local ${v}_rkc=0
local ${v}_rki=${interval}
local function ${v}_rk(hc)
${v}_rkc=${v}_rkc+1
if ${v}_rkc%${v}_rki==0 then
for op,_ in pairs(hc) do hc[op]=nil end
end
end`;
    }

    applySelfModifyPass(bytecodeArray, buildConfig, vmArch) {
        const mask = vmArch.activeConfig.smXorMask;
        const smOp = vmArch.getOpcode('SMBC');
        const nopOp = vmArch.getOpcode('NOP');
        const regions = [];
        const regionCount = buildConfig.seededRandomInt(3, 8);
        for (let r = 0; r < regionCount; r++) {
            const start = buildConfig.seededRandomInt(10, Math.max(11, bytecodeArray.length - 20));
            const len = buildConfig.seededRandomInt(2, 6);
            if (start + len >= bytecodeArray.length) continue;
            let safe = true;
            for (const existing of regions) {
                if (Math.abs(start - existing.start) < existing.len + 6) { safe = false; break; }
            }
            if (!safe) continue;
            regions.push({ start, len });
        }
        const patches = [];
        for (const region of regions) {
            for (let i = 0; i < region.len; i++) {
                if (region.start + i < bytecodeArray.length) {
                    bytecodeArray[region.start + i] = (bytecodeArray[region.start + i] ^ mask) & 0xFF;
                }
            }
            patches.push({ insertBefore: region.start, targetPos: region.start + 4, mask, len: region.len });
        }
        patches.sort((a, b) => b.insertBefore - a.insertBefore);
        for (const patch of patches) {
            const smBytes = [smOp, (patch.targetPos) & 0xFF, mask & 0xFF, patch.len & 0xFF];
            bytecodeArray.splice(patch.insertBefore, 0, ...smBytes);
            for (const otherPatch of patches) {
                if (otherPatch !== patch && otherPatch.insertBefore >= patch.insertBefore) {
                    otherPatch.targetPos += 4;
                }
            }
        }
        return bytecodeArray;
    }

    generateOneShotRuntime(config) {
        const v = this.buildConfig.generateId(4);
        const integrityOps = ['CHKDBG', 'CHKENV', 'ANTIHOOK', 'CHKEMU', 'CHKSBOX'].map(op => this.vmArch.opcodeMap[op]?.code).filter(c => c !== undefined);
        const oneshotOps = integrityOps.slice(0, this.buildConfig.seededRandomInt(2, integrityOps.length));
        return `local ${v}_os={${oneshotOps.map(o => `[${o}]=true`).join(',')}}
local ${v}_oe={}
local function ${v}_osc(op,hc)
if ${v}_os[op] and ${v}_oe[op] then hc[op]=nil return true end
if ${v}_os[op] then ${v}_oe[op]=true end
return false
end`;
    }

    serializeConstants(encConstants) {
        const self = this;
        function serializeOne(c) {
            if (c.t === 's') return `{t="s",d={${c.d.join(',')}},k={${c.k.join(',')}},n={${c.n.join(',')}}}`;
            if (c.t === 'i') return `{t="i",d={${c.d.join(',')}},k={${c.k.join(',')}},n={${c.n.join(',')}}}`;
            if (c.t === 'n') return `{t="n",v=${c.v}}`;
            if (c.t === 'f') {
                const subK = c.k.map(k => serializeOne(k)).join(',');
                return `{t="f",bc={${c.bc.join(',')}},bk={${c.bk.join(',')}},bn={${c.bn.join(',')}},k={${subK}},p=${c.p},va=${c.va}}`;
            }
            return `{t="r",v=${JSON.stringify(c.v)}}`;
        }
        return encConstants.map(c => serializeOne(c)).join(',');
    }

    generateRuntime(compiled) {
        let bcBytes = [...compiled.bytecode];
        bcBytes = this.applySelfModifyPass(bcBytes, this.buildConfig, this.vmArch);
        const encBytecode = this.encryptBytecode(bcBytes);
        const encConstants = this.encryptConstants(compiled.constants);
        const checksum = this.integritySystem.computeChecksum(bcBytes);
        const vmName = this.genVar('VM');
        const bcVar = this.genVar('bc');
        const ksVar = this.genVar('ks');
        const encHandlers = this.generateEncryptedHandlers();
        const config = this.vmArch.activeConfig;
        const maskedKeyBytes = this.integritySystem.maskHandlerKey(this.handlerKeyBytes);
        const bcKeyStr = `{${encBytecode.key.join(',')}}`;
        const bcNonceStr = `{${encBytecode.nonce.join(',')}}`;
        const serializedConstants = this.serializeConstants(encConstants);
        const encHandlersSerialized = Object.entries(encHandlers).map(([op, enc]) => `[${op}]={d={${enc.data.join(',')}},n={${enc.nonce.join(',')}}}`).join(',');
        const opaquePredicates = this.cfObfuscator.generateOpaquePredicateRuntime(5);
        const opaqueGuard = this.cfObfuscator.generateOpaqueGuard(opaquePredicates);
        const opaqueLua = this.cfObfuscator.generateOpaquePredicateLua(opaquePredicates);
        const rekeyRuntime = this.generateRekeyRuntime(config);
        const oneShotRuntime = this.generateOneShotRuntime(config);
        const rekeyFn = rekeyRuntime.match(/local function (\S+)\(/)[1];
        const osFn = oneShotRuntime.match(/local function (\S+)\(/)[1];

        return `do
${this.generateBitLib()}
${this.generateTableUnpack()}
${this.integritySystem.generateAntiDebug()}
${this.integritySystem.generateEnvCheck()}
${this.integritySystem.generateHookDetection()}
${this.integritySystem.generateAntiEmulation()}
${this.integritySystem.generateSandboxDetection()}
${this.integritySystem.generateTimingCheck()}
${this.generateDecryptionRuntime(encBytecode.method)}
${this.integritySystem.generateIntegrityKeyDerivation(maskedKeyBytes)}
${this.generateHandlerDecryptor()}
${opaqueLua}
${rekeyRuntime}
${oneShotRuntime}
local function _ds(d,k,n) local r=_dec(d,type(k)=="table" and k or {k},type(n)=="table" and n or {}) local rl=r[1]+(r[2] or 0)*256+(r[3] or 0)*65536+(r[4] or 0)*16777216 local s="" for i=5,4+rl do s=s..string.char(r[i] or 0) end return s end
local function _di(d,k,n) local r=_dec(d,type(k)=="table" and k or {k},type(n)=="table" and n or {}) return r[1]+(r[2] or 0)*256+(r[3] or 0)*65536+(r[4] or 0)*16777216 end
local function _dk(ks)
local r={}
for i,c in ipairs(ks) do
if c.t=="s" then r[i]=_ds(c.d,c.k,c.n)
elseif c.t=="i" then r[i]=_di(c.d,c.k,c.n)
elseif c.t=="n" then r[i]=c.v
elseif c.t=="f" then r[i]={_t="f",_bc=c.bc,_bk=c.bk,_bn=c.bn,_k=_dk(c.k),_p=c.p,_va=c.va}
else r[i]=c.v end
end
return r
end
local function _dbc(bc,k,n) return _dec(bc,type(k)=="table" and k or {k},type(n)=="table" and n or {}) end
local _EH={${encHandlersSerialized}}
local _HC={}
local ${vmName}={}
${vmName}.__index=${vmName}
function ${vmName}.new(bc,bk,bn,ks)
local s=setmetatable({},${vmName})
s._C=_dbc(bc,bk,bn)
s._K=_dk(ks)
s._stk={}
s._L={}
s._U=nil
s._va=nil
s._G=_G
s._pc=1
s._run=true
s._vm=${vmName}
s._rkc=0
return s
end
function ${vmName}:push(v) self._stk[#self._stk+1]=v end
function ${vmName}:pop() local v=self._stk[#self._stk] self._stk[#self._stk]=nil return v end
function ${vmName}:peek() return self._stk[#self._stk] end
function ${vmName}:r8() local b=self._C[self._pc] or 0 self._pc=self._pc+1 return b end
local function _gh(op)
if not _HC[op] then
local e=_EH[op]
if e then
local ok,h=pcall(_dh,e,_HK0)
if ok and h then _HC[op]=h end
end
end
return _HC[op]
end
function ${vmName}:run()
local _sc=0
while self._run and self._pc<=#self._C do
local op=self:r8()
_sc=_sc+1
if ${osFn}(op,_HC) then
end
if _sc%${config.rekeyInterval}==0 then
${rekeyFn}(_HC)
end
local h=_gh(op)
if h then
local r=h(self)
if r~=nil then return r end
elseif _EH[op] then
local ok2,h2=pcall(_dh,_EH[op],_HK0)
if ok2 and h2 then _HC[op]=h2 local r=h2(self) if r~=nil then return r end end
end
end
return self:pop()
end
local ${bcVar}={${encBytecode.data.join(',')}}
local ${ksVar}={${serializedConstants}}
local _cs={${checksum.h1},${checksum.h2},${checksum.h3},${checksum.h4}}
local function _vcs()
local bc=_dbc(${bcVar},${bcKeyStr},${bcNonceStr})
local h1,h2,h3,h4=${this.integritySystem.seed},${this.integritySystem.seed}~0x6a09e667,${this.integritySystem.seed}~0xbb67ae85,${this.integritySystem.seed}~0x3c6ef372
local len=#bc
for i=1,len,16 do
local k1=bit_or(bit_or(bit_or(bc[i] or 0,bit_lshift(bc[i+1] or 0,8)),bit_lshift(bc[i+2] or 0,16)),bit_lshift(bc[i+3] or 0,24))
local k2=bit_or(bit_or(bit_or(bc[i+4] or 0,bit_lshift(bc[i+5] or 0,8)),bit_lshift(bc[i+6] or 0,16)),bit_lshift(bc[i+7] or 0,24))
local k3=bit_or(bit_or(bit_or(bc[i+8] or 0,bit_lshift(bc[i+9] or 0,8)),bit_lshift(bc[i+10] or 0,16)),bit_lshift(bc[i+11] or 0,24))
local k4=bit_or(bit_or(bit_or(bc[i+12] or 0,bit_lshift(bc[i+13] or 0,8)),bit_lshift(bc[i+14] or 0,16)),bit_lshift(bc[i+15] or 0,24))
k1=bit_and(k1*0x239b961b,0xFFFFFFFF) k1=bit_or(bit_lshift(k1,15),bit_rshift(k1,17)) k1=bit_and(k1*0xab0e9789,0xFFFFFFFF) h1=bit_xor(h1,k1)
h1=bit_or(bit_lshift(h1,19),bit_rshift(h1,13)) h1=bit_and(h1+h2,0xFFFFFFFF) h1=bit_and(h1*5+0x561ccd1b,0xFFFFFFFF)
k2=bit_and(k2*0xab0e9789,0xFFFFFFFF) k2=bit_or(bit_lshift(k2,16),bit_rshift(k2,16)) k2=bit_and(k2*0x38b34ae5,0xFFFFFFFF) h2=bit_xor(h2,k2)
h2=bit_or(bit_lshift(h2,17),bit_rshift(h2,15)) h2=bit_and(h2+h3,0xFFFFFFFF) h2=bit_and(h2*5+0x0bcaa747,0xFFFFFFFF)
k3=bit_and(k3*0x38b34ae5,0xFFFFFFFF) k3=bit_or(bit_lshift(k3,17),bit_rshift(k3,15)) k3=bit_and(k3*0xa1e38b93,0xFFFFFFFF) h3=bit_xor(h3,k3)
h3=bit_or(bit_lshift(h3,15),bit_rshift(h3,17)) h3=bit_and(h3+h4,0xFFFFFFFF) h3=bit_and(h3*5+0x96cd1c35,0xFFFFFFFF)
k4=bit_and(k4*0xa1e38b93,0xFFFFFFFF) k4=bit_or(bit_lshift(k4,18),bit_rshift(k4,14)) k4=bit_and(k4*0x239b961b,0xFFFFFFFF) h4=bit_xor(h4,k4)
h4=bit_or(bit_lshift(h4,13),bit_rshift(h4,19)) h4=bit_and(h4+h1,0xFFFFFFFF) h4=bit_and(h4*5+0x32ac3b17,0xFFFFFFFF)
end
h1=bit_xor(h1,len) h2=bit_xor(h2,len) h3=bit_xor(h3,len) h4=bit_xor(h4,len)
h1=bit_and(h1+h2+h3+h4,0xFFFFFFFF) h2=bit_and(h2+h1,0xFFFFFFFF) h3=bit_and(h3+h1,0xFFFFFFFF) h4=bit_and(h4+h1,0xFFFFFFFF)
h1=bit_xor(h1,bit_rshift(h1,16)) h1=bit_and(h1*0x85ebca6b,0xFFFFFFFF) h1=bit_xor(h1,bit_rshift(h1,13)) h1=bit_and(h1*0xc2b2ae35,0xFFFFFFFF) h1=bit_xor(h1,bit_rshift(h1,16))
h2=bit_xor(h2,bit_rshift(h2,16)) h2=bit_and(h2*0x85ebca6b,0xFFFFFFFF) h2=bit_xor(h2,bit_rshift(h2,13)) h2=bit_and(h2*0xc2b2ae35,0xFFFFFFFF) h2=bit_xor(h2,bit_rshift(h2,16))
h3=bit_xor(h3,bit_rshift(h3,16)) h3=bit_and(h3*0x85ebca6b,0xFFFFFFFF) h3=bit_xor(h3,bit_rshift(h3,13)) h3=bit_and(h3*0xc2b2ae35,0xFFFFFFFF) h3=bit_xor(h3,bit_rshift(h3,16))
h4=bit_xor(h4,bit_rshift(h4,16)) h4=bit_and(h4*0x85ebca6b,0xFFFFFFFF) h4=bit_xor(h4,bit_rshift(h4,13)) h4=bit_and(h4*0xc2b2ae35,0xFFFFFFFF) h4=bit_xor(h4,bit_rshift(h4,16))
return h1==_cs[1] and h2==_cs[2] and h3==_cs[3] and h4==_cs[4]
end
if ${this.integritySystem.getGuardCondition()} and _vcs() and ${opaqueGuard} then
local vm=${vmName}.new(${bcVar},${bcKeyStr},${bcNonceStr},${ksVar})
vm:run()
end
end`;
    }
}

class OclareEngine {
    constructor() { this.version = '1.0'; }

    async process(code, options = {}) {
        const target = options.target || LuaTarget.LUA_53;
        const buildConfig = new BuildConfig(options.seed);
        await _sodiumReady;
        const lexer = new LuaLexer(code, target);
        const tokens = lexer.tokenize();
        const parser = new LuaParser(tokens, target);
        const ast = parser.parse();
        const vmArch = new VMArchitect(buildConfig, target);
        const irBuilder = new IRBuilder();
        const irResult = irBuilder.lower(ast);
        const compiler = new BytecodeCompiler(vmArch, target);
        const compiled = compiler.compile(irResult);
        const integritySystem = new IntegritySystem(buildConfig);
        const cryptoSystem = new CryptoSystem(buildConfig, _sodium);
        const cfObfuscator = new ControlFlowObfuscator(buildConfig);
        const obfuscator = new VMObfuscator(buildConfig, vmArch, target, integritySystem, cryptoSystem, cfObfuscator);
        const output = obfuscator.generateRuntime(compiled);
        return {
            code: output, target: target,
            techniques: [
                'AST->IR->Bytecode Pipeline','Semantic Displacement Per VM','Encrypted Stateful Handlers with Re-Keying',
                'Real Self-Modifying Bytecode (JIT Un-XOR)','One-Shot Integrity Handlers','Runtime Entropy (Non-Deterministic)',
                'Control-Flow Flattened Dispatcher','ChaCha20 Stream Cipher (256-bit)','XSalsa20-Poly1305 Authenticated Encryption',
                'MurmurHash3 128-bit Integrity Checksum','Integrity-Woven Key Derivation','Anti-Debug / Anti-Hook Detection',
                'Anti-Emulation (QEMU/Docker/Wine)','Sandbox Detection','Timing Attack Protection',
                'Environment Integrity Verification','Runtime Opaque Predicates','Dead Code & Fake Handler Injection',
                'Per-VM Immediate/Jump Encoding Keys','Conditional Inversion Per VM','Operand Order Displacement',
                'Boxed-Cell Upvalue Model','Multi-Return Propagation (MRET)','String Length Obfuscation (Padded Encryption)',
                '32-bit Jump Encoding (Overflow-Safe)','Bogus Execution Paths','Trap Opcodes'
            ],
            stats: {
                bytecodeSize: compiled.bytecode.length, constantsCount: compiled.constants.length,
                irInstructions: irResult.instructions.length, closureCount: irResult.closures.length,
                buildId: buildConfig.BUILD_ID, selectedVM: vmArch.selectedVM,
                vmConfig: vmArch.activeConfig.name, vmStyle: vmArch.activeConfig.style,
                wordSize: vmArch.activeConfig.wordSize, endianness: vmArch.activeConfig.endianness,
                semanticDisplacement: {
                    immediateKey: vmArch.activeConfig.immediateKey, jumpKey: vmArch.activeConfig.jumpKey,
                    jumpRelative: vmArch.activeConfig.jumpRelative, invertConditionals: vmArch.activeConfig.invertConditionals,
                    popOrderSwap: vmArch.activeConfig.popOrderSwap, addTransform: vmArch.activeConfig.addTransform,
                    callConvention: vmArch.activeConfig.callConvention
                },
                target: target, encryptionMethod: _sodium ? 'xsalsa20poly1305' : 'chacha20', version: this.version
            }
        };
    }
}

self.onmessage = async function(ev) {
    const msg = ev.data || {};
    const id = msg.id || null;
    if (msg.type === 'poly' || msg.type === 'vm-only') {
        postProgress(id, 'init', 0, 'Initializing Oclare Engine V1.0');
        try {
            const engine = new OclareEngine();
            postProgress(id, 'parse', 10, 'Parsing Lua source');
            postProgress(id, 'ir', 25, 'Lowering AST to IR');
            postProgress(id, 'compile', 40, 'Compiling IR to VM bytecode');
            postProgress(id, 'displace', 55, 'Applying semantic displacement');
            postProgress(id, 'encrypt', 70, 'Encrypting handlers and bytecode');
            postProgress(id, 'integrity', 85, 'Generating integrity checks');
            postProgress(id, 'obfuscate', 95, 'Assembling protected runtime');
            const out = await engine.process(msg.code || '', msg.options || {});
            postProgress(id, 'done', 100, 'Complete');
            self.postMessage({ type: 'poly-result', id, lang: 'lua', code: out.code, stats: out.stats, techniques: out.techniques });
        } catch (e) {
            self.postMessage({ type: 'error', id, error: e && e.message ? e.message : String(e) });
        }
    } else if (msg.type === 'cancel') {
        self.postMessage({ type: 'cancelled', id });
    } else {
        self.postMessage({ type: 'error', id, error: 'Unknown message type' });
    }
};

self.addEventListener('error', (e) => {
    self.postMessage({ type: 'error', error: e && e.message ? e.message : String(e) });
});

if (typeof module !== 'undefined') {
    module.exports = { LuaLexer, LuaParser, IRBuilder, IROp, BytecodeCompiler, VMArchitect, VMObfuscator, IntegritySystem, CryptoSystem, ControlFlowObfuscator, OclareEngine, BuildConfig, LuaTarget, LuaFeatures };
}
self.onmessage = (e) => {
  try {
    const lua = e.data;

    // whatever your obfuscation entry function is
    const output = OCLARE_RUN(lua); // ← example name

    self.postMessage({
      result: output
    });
  } catch (err) {
    self.postMessage({
      result: "-- obfuscation failed --"
    });
  }
};
