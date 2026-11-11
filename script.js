/* ============================================================
   PARKOUR RUN — DEVIL EDITION
   Engine 2D de tela única inspirada em Level Devil
   ============================================================ */

'use strict';

/* ------------------------------------------------------------------
   Utilidades
------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const rand = (min, max) => min + Math.random() * (max - min);
const pad2 = (n) => String(n).padStart(2, '0');
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

/* ------------------------------------------------------------------
   Constantes do jogo
------------------------------------------------------------------ */

const GAME_W = 1600;
const GAME_H = 900;
const FLOOR_Y = 770;

const PLAYER_W = 46;
const PLAYER_H = 46;

const STEP = 1 / 120;
const GRAVITY = 2500;
const MAX_FALL = 1500;
const MOVE_SPEED = 400;
const ACCEL = 3200;
const FRICTION = 2800;
const JUMP_VELOCITY = -950;
const JUMP_CUT = -330;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER_TIME = 0.13;

/* ------------------------------------------------------------------
   Canvas / viewport
------------------------------------------------------------------ */

const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

function resizeCanvas() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.dpr = dpr;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const scale = Math.min(w / GAME_W, h / GAME_H);
    view.scale = scale * dpr;
    view.ox = ((w - GAME_W * scale) / 2) * dpr;
    view.oy = ((h - GAME_H * scale) / 2) * dpr;
}

window.addEventListener('resize', resizeCanvas);

/* ------------------------------------------------------------------
   Estado global
------------------------------------------------------------------ */

const game = {
    screen: 'intro',
    phase: 'idle',
    paused: false,
    levelIndex: 0,
    deaths: 0,
    runTime: 0,
    lastHudSecond: -1,
    completed: 0,
    worldIndex: 0,
    worldMapIndex: 0,
    pendingLevel: null,
    soundOn: true,
    shakeT: 0,
    shakeDur: 1,
    shakeMag: 0,
    flash: 0,
    deathTimer: 0,
    clearTimer: 0
};

const player = {
    x: 0,
    y: 0,
    w: PLAYER_W,
    h: PLAYER_H,
    vx: 0,
    vy: 0,
    onGround: false,
    ground: null,
    coyote: 0,
    jumpBuffer: 0,
    facing: 1,
    squash: 0,
    runCycle: 0,
    dead: false
};

const input = { left: false, right: false, jump: false };

let world = null;
let particles = [];

let bannerTimeout = null;
let mapMessageTimeout = null;
let worldTransitionTimer = null;

const TOTAL_WORLDS = 2;

const IS_TOUCH = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

/* ------------------------------------------------------------------
   Partículas
------------------------------------------------------------------ */

function burst(x, y, color, count, speed = 420, opts = {}) {
    const gravity = opts.gravity !== undefined ? opts.gravity : 1200;
    const size = opts.size || 6;
    for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const velocity = rand(speed * 0.25, speed);
        const life = rand(0.35, 0.85);
        particles.push({
            x,
            y,
            vx: Math.cos(angle) * velocity,
            vy: Math.sin(angle) * velocity - rand(0, speed * 0.35),
            life,
            maxLife: life,
            size: rand(size * 0.5, size),
            color,
            gravity
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        p.vy += p.gravity * dt;
        p.vx *= 0.995;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
}

/* ------------------------------------------------------------------
   Áudio sintetizado
------------------------------------------------------------------ */

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
            return;
        }
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        try {
            this.ctx = new AudioCtor();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.enabled ? 0.5 : 0;
            this.master.connect(this.ctx.destination);
        } catch (err) {
            this.ctx = null;
        }
    }

    setEnabled(on) {
        this.enabled = on;
        if (this.master) this.master.gain.value = on ? 0.5 : 0;
        if (on) this.init();
    }

    tone({ freq = 440, endFreq = null, dur = 0.12, type = 'square', vol = 0.1, delay = 0 } = {}) {
        if (!this.ctx || !this.enabled) return;
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(Math.max(20, freq), t0);
        if (endFreq) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
        }
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.03);
    }

    noise({ dur = 0.2, vol = 0.1, freq = 800, q = 1, delay = 0 } = {}) {
        if (!this.ctx || !this.enabled) return;
        const sampleRate = this.ctx.sampleRate;
        const length = Math.max(1, Math.floor(sampleRate * dur));
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

        const t0 = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq, t0);
        filter.Q.value = q;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
    }

    jump() {
        this.tone({ freq: 300, endFreq: 640, dur: 0.11, type: 'square', vol: 0.07 });
    }

    land() {
        this.tone({ freq: 130, endFreq: 80, dur: 0.07, type: 'triangle', vol: 0.05 });
    }

    death() {
        this.tone({ freq: 260, endFreq: 42, dur: 0.46, type: 'sawtooth', vol: 0.11 });
        this.noise({ dur: 0.32, vol: 0.1, freq: 520 });
    }

    trap() {
        this.tone({ freq: 150, endFreq: 72, dur: 0.17, type: 'square', vol: 0.07 });
        this.noise({ dur: 0.1, vol: 0.05, freq: 360 });
    }

    crumble() {
        this.noise({ dur: 0.26, vol: 0.09, freq: 340, q: 0.7 });
    }

    teleport() {
        this.tone({ freq: 980, endFreq: 180, dur: 0.22, type: 'sine', vol: 0.08 });
        this.tone({ freq: 1500, endFreq: 420, dur: 0.14, type: 'triangle', vol: 0.035, delay: 0.015 });
    }

    crusher() {
        this.tone({ freq: 82, endFreq: 38, dur: 0.3, type: 'sine', vol: 0.18 });
        this.noise({ dur: 0.24, vol: 0.12, freq: 190, q: 0.5 });
    }

    win() {
        [523, 659, 784, 1047].forEach((freq, i) => {
            this.tone({ freq, dur: 0.16, type: 'square', vol: 0.065, delay: i * 0.085 });
        });
    }
}

const sfx = new SoundEngine();

/* ------------------------------------------------------------------
   Helpers de construção das fases
------------------------------------------------------------------ */

function addSolid(x, y, w, h, opts = {}) {
    const solid = {
        x,
        y,
        w,
        h,
        originX: x,
        originY: y,
        active: true,
        state: 'idle',
        timer: 0,
        vy: 0,
        phase: 0,
        ...opts
    };
    if (solid.move && typeof solid.move.phase === 'number') {
        solid.phase = solid.move.phase;
    }
    world.solids.push(solid);
    return solid;
}

function hiddenSpikeOffset(spike) {
    if (spike.dir === 'up') return spike.h;
    if (spike.dir === 'down') return -spike.h;
    if (spike.dir === 'left') return -spike.w;
    return spike.w;
}

function addSpikes(x, y, w, h, dir = 'up', opts = {}) {
    const spike = {
        x,
        y,
        w,
        h,
        dir,
        offset: 0,
        targetOffset: 0,
        speed: 1300,
        delay: 0,
        active: true,
        warning: false,
        ...opts
    };
    if (opts.hidden) {
        spike.offset = hiddenSpikeOffset(spike);
        spike.targetOffset = spike.offset;
    }
    world.spikes.push(spike);
    return spike;
}

function popSpikes(spike, delay = 0) {
    spike.targetOffset = 0;
    spike.delay = delay;
}

function addDoor(x, opts = {}) {
    world.door = {
        x,
        y: FLOOR_Y - 110,
        w: 78,
        h: 110,
        locked: false,
        hidden: false,
        ...opts
    };
    return world.door;
}

function addFakeDoor(x) {
    const door = { x, y: FLOOR_Y - 110, w: 78, h: 110, active: true };
    world.fakeDoors.push(door);
    return door;
}

function addSign(x, y, text) {
    const sign = { x, y, text };
    world.signs.push(sign);
    return sign;
}

function addCrusher(x, initialDelay = 1) {
    const crusher = {
        x,
        y: -250,
        w: 150,
        h: 300,
        restY: -250,
        slamY: FLOOR_Y - 300,
        state: 'idle',
        timer: initialDelay,
        vy: 0
    };
    world.crushers.push(crusher);
    return crusher;
}

function floorExistsAt(x) {
    return world.solids.some((solid) => {
        return solid.active && !solid.noCollide &&
            !solid.crumble && !solid.falling && !solid.move &&
            Math.abs(solid.y - FLOOR_Y) < 1 &&
            x > solid.x + 12 && x < solid.x + solid.w - 12;
    });
}

function addLaser(x, phase = 0) {
    world.lasers.push({
        x,
        width: 14,
        top: 150,
        phase,
        cycle: 2.8,
        state: 'off'
    });
}

function addFireJet(x, phase = 0) {
    world.fireJets.push({
        x,
        width: 66,
        height: 168,
        phase,
        cycle: 2.3,
        state: 'off'
    });
}

function addSaw(x, y, baseX, amp, phase) {
    world.saws.push({
        x,
        y,
        baseX,
        amp,
        speed: 0.8 + (phase % 3) * 0.18,
        phase,
        angle: 0,
        radius: 27
    });
}

function spawnRock() {
    const doorX = world.door ? world.door.x : 1450;
    let x = rand(180, 1380);
    for (let i = 0; i < 12; i++) {
        const awayFromPlayer = Math.abs(x - (player.x + player.w / 2)) > 120;
        const awayFromDoor = Math.abs(x - doorX) > 110;
        if (awayFromPlayer && awayFromDoor) break;
        x = rand(180, 1380);
    }

    world.rocks.push({
        x,
        y: -60,
        w: 36,
        h: 36,
        vy: 0,
        warn: 0.55,
        spin: rand(0, Math.PI * 2)
    });
}

function applyWorld2Mods(index) {
    world.world2 = true;
    world.nextRock = 1.2;

    const doorX = world.door ? world.door.x : 1450;
    const safeLaser = (x) => x > 260 && Math.abs(x - doorX) > 130;
    const laserCandidates = [330, 520, 710, 900, 1090, 1270];

    for (let i = 0; i < laserCandidates.length; i++) {
        const x = laserCandidates[(index * 2 + i) % laserCandidates.length];
        if (safeLaser(x)) {
            addLaser(x, (index * 0.37) % 2.8);
            break;
        }
    }

    const fireCandidates = [360, 560, 760, 960, 1160, 1300];
    for (let i = 0; i < fireCandidates.length; i++) {
        const x = fireCandidates[(index + i + 3) % fireCandidates.length];
        if (floorExistsAt(x) && Math.abs(x - doorX) > 130) {
            addFireJet(x, (index * 0.45) % 2.3);
            break;
        }
    }

    if (index % 3 === 1) {
        addSaw(300 + (index * 23) % 240, 710, 330 + (index * 31) % 240, 110 + (index % 3) * 30, index * 0.7);
    }
}

function addTrigger(test, fn) {
    world.triggers.push({ test, fn, done: false });
}

function once(key, test, fn) {
    world.flags[key] = false;
    addTrigger(
        (p) => !world.flags[key] && test(p),
        () => {
            world.flags[key] = true;
            fn();
        }
    );
}

function addScript(fn) {
    world.scripts.push(fn);
}

function after(seconds, fn) {
    world.timers.push({ at: world.t + seconds, fn, done: false });
}

function msg(text, tone = 'red', duration = 1900) {
    showBanner(text, tone, duration);
}

function shake(magnitude, duration) {
    game.shakeMag = Math.max(game.shakeMag, magnitude);
    game.shakeDur = duration;
    game.shakeT = duration;
}

function setDark(on) {
    world.dark = on;
}

function spawnMeteor() {
    let cx = rand(180, 1420);
    for (let i = 0; i < 10; i++) {
        if (Math.abs(cx - (player.x + player.w / 2)) > 130) break;
        cx = rand(180, 1420);
    }
    world.projectiles.push({
        x: cx,
        y: -70,
        w: 38,
        h: 42,
        vy: 0,
        warn: 0.4,
        spin: rand(0, Math.PI * 2)
    });
}

/* ------------------------------------------------------------------
   Fases
------------------------------------------------------------------ */

const LEVELS = [
    {
        name: 'FÁCIL, NÉ?',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1390);
            addSign(300, 655, 'VÁ ATÉ A PORTA');
            addSign(790, 655, 'O QUE PODERIA DAR ERRADO?');

            once('firstTroll', (p) => p.x > 820, () => {
                const spike = addSpikes(1070, FLOOR_Y - 44, 90, 44, 'up', { hidden: true });
                popSpikes(spike);
                msg('ACHOU QUE SERIA FÁCIL?');
                shake(5, 0.2);
                sfx.trap();
            });
        }
    },
    {
        name: 'O CHÃO MENTE',
        build() {
            addSolid(0, FLOOR_Y, 480, 130);
            addSolid(540, FLOOR_Y, 280, 130, { crumble: true });
            addSolid(880, FLOOR_Y, 280, 130, { crumble: true });
            addSolid(1220, FLOOR_Y, 380, 130);
            addDoor(1460);
            addSpikes(480, 840, 740, 44, 'up');
            addSign(180, 655, 'NÃO HÁ NADA DE ERRADO AQUI');

            once('floorTroll', (p) => p.x > 470, () => {
                msg('O CHÃO É UMA MENTIRA!');
                sfx.trap();
                shake(3, 0.2);
            });
        }
    },
    {
        name: 'OLHE PARA CIMA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addSolid(0, 0, GAME_W, 64);
            addSolid(540, 480, 1060, 30);
            addDoor(1450);
            addSign(250, 655, 'OLHE PARA CIMA');

            const traps = [
                { x: 620, phase: 0 },
                { x: 900, phase: 0.95 },
                { x: 1180, phase: 1.9 }
            ];

            traps.forEach((trap) => {
                const spike = addSpikes(trap.x, 510, 110, 260, 'down', { hidden: true, speed: 1100 });
                const cycle = 2.8;

                addScript(() => {
                    if (!world) return;
                    const time = (world.diffT + trap.phase) % cycle;
                    const down = time > 1.05 && time < 2.05;
                    spike.warning = time > 0.75 && time < 1.05;
                    spike.targetOffset = down ? 0 : -260;
                });
            });
        }
    },
    {
        name: 'A PORTA FOGE',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const door = addDoor(1350);
            addSign(220, 655, 'A SAÍDA É À DIREITA');

            const relocate = (x, text) => {
                burst(door.x + door.w / 2, door.y + door.h / 2, '#f2f0ea', 16, 360, { gravity: 200, size: 5 });
                door.x = x;
                burst(door.x + door.w / 2, door.y + door.h / 2, '#f2f0ea', 16, 360, { gravity: 200, size: 5 });
                msg(text);
                sfx.teleport();
                shake(5, 0.18);
            };

            once('door1', (p) => p.x > 900, () => relocate(150, 'A PORTA FOGE!'));
            once('door2', (p) => p.x < 360, () => relocate(780, 'SÉRIO?'));
            once('door3', (p) => p.x > 640, () => relocate(1210, 'AGORA FICA.'));

            const spike = addSpikes(1010, FLOOR_Y - 44, 100, 44, 'up', { hidden: true });
            once('doorSpike', (p) => world.flags.door3 && p.x > 840, () => {
                popSpikes(spike);
                msg('QUASE!');
                sfx.trap();
                shake(4, 0.2);
            });
        }
    },
    {
        name: 'NÃO CONFIE NAS PLATAFORMAS',
        build() {
            addSolid(0, FLOOR_Y, 420, 130);
            addSolid(1180, FLOOR_Y, 420, 130);
            addDoor(1470);
            addSpikes(420, 840, 760, 44, 'up');
            addSolid(480, 690, 170, 30, { crumble: true });
            addSolid(720, 600, 170, 30, { falling: true });
            addSolid(990, 690, 160, 30, { crumble: true });
            addSign(240, 655, 'NÃO CONFIE NAS PLATAFORMAS');
        }
    },
    {
        name: 'ESPINHOS SURPRESA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1490);
            addSign(240, 655, 'ESPINHOS? ONDE?');

            const traps = [
                { trigger: 300, x: 570, w: 150 },
                { trigger: 650, x: 900, w: 150 },
                { trigger: 960, x: 1210, w: 150 }
            ];

            traps.forEach((trap, index) => {
                const spike = addSpikes(trap.x, FLOOR_Y - 44, trap.w, 44, 'up', { hidden: true });
                once('spike' + index, (p) => p.x > trap.trigger, () => {
                    popSpikes(spike);
                    sfx.trap();
                    shake(4, 0.16);
                });
            });

            once('spikeMsg', (p) => p.x > 280, () => msg('PULE!'));
        }
    },
    {
        name: 'NO ESCURO',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1470);
            addSign(180, 655, 'NÃO TENHA MEDO DO ESCURO');

            const spike1 = addSpikes(900, FLOOR_Y - 44, 120, 44, 'up', { hidden: true });
            const spike2 = addSpikes(1180, FLOOR_Y - 44, 120, 44, 'up', { hidden: true });

            once('darkTroll', (p) => p.x > 500, () => {
                setDark(true);
                msg('QUEM APAGOU A LUZ?');
                sfx.trap();
                shake(4, 0.25);
            });

            once('darkSpike1', (p) => world.dark && p.x > 670, () => {
                popSpikes(spike1);
                sfx.trap();
            });

            once('darkSpike2', (p) => world.dark && p.x > 960, () => {
                popSpikes(spike2);
                sfx.trap();
            });
        }
    },
    {
        name: 'A PRENSA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1490);
            addSign(240, 655, 'PASSE QUANDO ESTIVER EM CIMA');
            addCrusher(560, 0.9);
            addCrusher(850, 1.9);
            addCrusher(1140, 2.9);
        }
    },
    {
        name: 'PAREDE FALSA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1470);
            addSign(540, 655, 'IMPOSSÍVEL PASSAR');

            const wall = addSolid(820, 480, 60, 290, { fakeWall: true });
            addSolid(1200, FLOOR_Y - 40, 60, 40);

            once('fakeWall', (p) => p.x + p.w > 816, () => {
                wall.active = false;
                burst(wall.x + 30, wall.y + 145, '#e7e4da', 30, 620, { gravity: 1300, size: 7 });
                msg('ERA MENTIRA!');
                shake(10, 0.3);
                sfx.crumble();

                const spike = addSpikes(1080, FLOOR_Y - 44, 120, 44, 'up', { hidden: true });
                popSpikes(spike);
                sfx.trap();
            });
        }
    },
    {
        name: 'PLATAFORMAS MÓVEIS',
        build() {
            addSolid(0, FLOOR_Y, 400, 130);
            addSolid(1160, FLOOR_Y, 440, 130);
            addDoor(1470);
            addSpikes(400, 840, 760, 44, 'up');
            addSolid(520, 650, 150, 28, { move: { axis: 'x', amp: 70, speed: 1.05, phase: 0 } });
            addSolid(800, 620, 150, 28, { move: { axis: 'y', amp: 75, speed: 0.85, phase: 1.2 } });
            addSolid(1010, 650, 140, 28, { move: { axis: 'x', amp: 55, speed: 1.3, phase: 2.1 } });
            addSign(100, 655, 'ESPIRE E ESPERE');
        }
    },
    {
        name: 'A PORTA FALSA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const realDoor = addDoor(1450, { hidden: true });
            const fakeDoor = addFakeDoor(1080);
            addSign(920, 655, 'SAÍDA');
            const spike = addSpikes(1080, FLOOR_Y - 44, 180, 44, 'up', { hidden: true, speed: 900 });

            once('fakeDoorTroll', (p) => p.x > 900, () => {
                fakeDoor.active = false;
                burst(fakeDoor.x + fakeDoor.w / 2, fakeDoor.y + fakeDoor.h / 2, '#f2f0ea', 30, 560, { gravity: 1200, size: 6 });
                popSpikes(spike);
                msg('NÃO ERA ESSA!');
                sfx.trap();
                shake(9, 0.3);

                after(0.45, () => {
                    realDoor.hidden = false;
                    burst(realDoor.x + realDoor.w / 2, realDoor.y + realDoor.h / 2, '#f2f0ea', 22, 420, { gravity: 150 });
                    msg('AGORA SIM. CORRE!');
                    sfx.teleport();
                });
            });
        }
    },
    {
        name: 'SOBREVIVA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const door = addDoor(1490, { locked: true });
            addSign(220, 655, 'SOBREVIVA');
            const lockedSign = addSign(1260, 655, 'A PORTA ESTÁ TRANCADA');

            world.countdown = 8;
            world.nextMeteor = 0.6;

            addScript(() => {
                if (!world) return;
                if (!world.flags.survive) {
                    world.countdown = Math.max(0, 8 - world.t);
                    if (world.t >= 8) {
                        world.flags.survive = true;
                        world.countdown = 0;
                        door.locked = false;
                        lockedSign.text = 'CORRE!';
                        world.chaseWall = { x: -260, speed: 235 };
                        msg('AGORA CORRE!');
                        shake(14, 0.5);
                        sfx.teleport();
                    } else if (world.t >= world.nextMeteor) {
                        world.nextMeteor = world.t + 0.62 / world.difficulty;
                        spawnMeteor();
                    }
                }
            });
        }
    },
    {
        name: 'A PORTA É MENTIRA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const realDoor = addDoor(1450, { hidden: true });
            const fakeDoor1 = addFakeDoor(720);
            const fakeDoor2 = addFakeDoor(1080);
            addSign(300, 655, 'A SAÍDA É LOGO ALI');

            const spikes1 = addSpikes(720, FLOOR_Y - 44, 170, 44, 'up', { hidden: true });
            const spikes2 = addSpikes(1080, FLOOR_Y - 44, 170, 44, 'up', { hidden: true });

            once('fakeDoorOne', (p) => p.x > 540, () => {
                fakeDoor1.active = false;
                burst(fakeDoor1.x + fakeDoor1.w / 2, fakeDoor1.y + fakeDoor1.h / 2, '#f2f0ea', 28, 540, { gravity: 1200, size: 6 });
                popSpikes(spikes1);
                msg('NÃO ERA ESSA!');
                sfx.trap();
                shake(8, 0.25);
            });

            once('fakeDoorTwo', (p) => p.x > 900, () => {
                fakeDoor2.active = false;
                burst(fakeDoor2.x + fakeDoor2.w / 2, fakeDoor2.y + fakeDoor2.h / 2, '#f2f0ea', 28, 540, { gravity: 1200, size: 6 });
                popSpikes(spikes2);
                msg('DE NOVO NÃO!');
                sfx.trap();
                shake(8, 0.25);

                after(0.45, () => {
                    realDoor.hidden = false;
                    burst(realDoor.x + realDoor.w / 2, realDoor.y + realDoor.h / 2, '#f2f0ea', 22, 420, { gravity: 150 });
                    msg('AGORA É DE VERDADE.');
                    sfx.teleport();
                });
            });
        }
    },
    {
        name: 'PISO DE VIDRO',
        build() {
            addSolid(0, FLOOR_Y, 360, 130);
            addSolid(1360, FLOOR_Y, 240, 130);
            addDoor(1480);
            addSpikes(360, 840, 1000, 44, 'up');
            addSign(150, 655, 'NÃO PARE');

            addSolid(420, 700, 120, 26, { crumble: true });
            addSolid(600, 650, 120, 26, { crumble: true });
            addSolid(780, 700, 120, 26, { crumble: true });
            addSolid(960, 650, 120, 26, { crumble: true });
            addSolid(1140, 700, 120, 26, { crumble: true });
        }
    },
    {
        name: 'A PORTA DANÇA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const door = addDoor(1350);
            addSign(230, 655, 'A PORTA ESTÁ ESPERANDO');

            const spike1 = addSpikes(850, FLOOR_Y - 44, 100, 44, 'up', { hidden: true });
            const spike2 = addSpikes(1050, FLOOR_Y - 44, 100, 44, 'up', { hidden: true });

            addScript(() => {
                door.x = 1350 + Math.sin(world.diffT * 1.15) * 110;
            });

            once('danceOne', (p) => p.x > 700, () => {
                popSpikes(spike1);
                msg('ELA NÃO PARA DE DANÇAR!');
                sfx.trap();
                shake(5, 0.2);
            });

            once('danceTwo', (p) => p.x > 900, () => {
                popSpikes(spike2);
                sfx.trap();
            });
        }
    },
    {
        name: 'TETO DE ESPINHOS',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addSolid(0, 0, GAME_W, 64);
            addSolid(500, 480, 1100, 30);
            addDoor(1490);
            addSign(200, 655, 'OLHE PARA CIMA');

            const xPositions = [540, 780, 1020, 1260];

            xPositions.forEach((x, index) => {
                const spike = addSpikes(x, 510, 100, 260, 'down', { hidden: true, speed: 1200 });
                const phase = index * 0.55;
                const cycle = 2.4;

                addScript(() => {
                    const time = (world.diffT + phase) % cycle;
                    const down = time > 0.9 && time < 1.8;
                    spike.warning = time > 0.6 && time < 0.9;
                    spike.targetOffset = down ? 0 : -260;
                });
            });
        }
    },
    {
        name: 'SALTO CEGO',
        build() {
            addSolid(0, FLOOR_Y, 360, 130);
            addSolid(1240, FLOOR_Y, 360, 130);
            addDoor(1480);
            addSpikes(360, 840, 880, 44, 'up');
            addSign(140, 655, 'SALTE NO ESCURO');

            addSolid(440, 680, 150, 28, { move: { axis: 'x', amp: 50, speed: 0.9, phase: 0 } });
            addSolid(760, 620, 150, 28, { move: { axis: 'y', amp: 60, speed: 0.8, phase: 1.1 } });
            addSolid(960, 680, 150, 28, { move: { axis: 'x', amp: 45, speed: 1.0, phase: 2.0 } });

            once('blindTroll', (p) => p.x > 300, () => {
                setDark(true);
                msg('A LUZ ACABOU.');
                sfx.trap();
                shake(5, 0.25);
            });
        }
    },
    {
        name: 'A FÁBRICA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1490);
            addSign(200, 655, 'A FÁBRICA NÃO PAROU');

            addCrusher(480, 0.9);
            addCrusher(880, 1.7);
            addCrusher(1280, 2.5);

            const spike1 = addSpikes(700, FLOOR_Y - 44, 80, 44, 'up', { hidden: true });
            const spike2 = addSpikes(1080, FLOOR_Y - 44, 80, 44, 'up', { hidden: true });

            once('factorySpikeOne', (p) => p.x > 450, () => {
                popSpikes(spike1);
                sfx.trap();
            });

            once('factorySpikeTwo', (p) => p.x > 820, () => {
                popSpikes(spike2);
                sfx.trap();
            });
        }
    },
    {
        name: 'PISO FALSO',
        build() {
            addSolid(0, FLOOR_Y, 660, 130);
            addSolid(880, FLOOR_Y, 720, 130);
            addDoor(1480);
            addSpikes(660, 840, 220, 44, 'up');
            addSolid(660, FLOOR_Y, 220, 130, { noCollide: true });
            addSign(320, 655, 'PISO NOVO. PODE CONFIAR.');

            once('fakeFloorTroll', (p) => p.x > 520, () => {
                msg('É SÓ UM PISO NORMAL.');
            });
        }
    },
    {
        name: 'CONTROLES NORMAIS',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1490);
            addSign(250, 655, 'TUDO NORMAL POR AQUI');

            const spike1 = addSpikes(1000, FLOOR_Y - 44, 90, 44, 'up', { hidden: true });
            const spike2 = addSpikes(1260, FLOOR_Y - 44, 90, 44, 'up', { hidden: true });

            once('invertTroll', (p) => p.x > 500, () => {
                world.invertControls = true;
                msg('ESQUERDA É DIREITA AGORA.');
                sfx.trap();
                shake(8, 0.3);
            });

            once('invertSpikeOne', (p) => world.invertControls && p.x > 880, () => {
                popSpikes(spike1);
                sfx.trap();
            });

            once('invertSpikeTwo', (p) => world.invertControls && p.x > 1140, () => {
                popSpikes(spike2);
                sfx.trap();
            });
        }
    },
    {
        name: 'PRENSAS GÊMEAS',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addDoor(1490);
            addSign(200, 655, 'UMA DE CADA VEZ');

            addCrusher(480, 0.8);
            addCrusher(740, 1.5);
            addCrusher(1000, 2.2);
            addCrusher(1260, 2.9);
        }
    },
    {
        name: 'ESCURO E PORTAS',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const realDoor = addDoor(1450, { hidden: true });
            const fakeDoor = addFakeDoor(1000);
            addSign(200, 655, 'A LUZ VAI VOLTAR');
            world.dark = true;

            const spike = addSpikes(1000, FLOOR_Y - 44, 180, 44, 'up', { hidden: true });

            once('darkFakeDoor', (p) => p.x > 880, () => {
                fakeDoor.active = false;
                burst(fakeDoor.x + fakeDoor.w / 2, fakeDoor.y + fakeDoor.h / 2, '#f2f0ea', 30, 560, { gravity: 1200, size: 6 });
                popSpikes(spike);
                msg('NÃO ERA ESSA!');
                sfx.trap();
                shake(9, 0.3);

                after(0.45, () => {
                    realDoor.hidden = false;
                    burst(realDoor.x + realDoor.w / 2, realDoor.y + realDoor.h / 2, '#f2f0ea', 22, 420, { gravity: 150 });
                    msg('AGORA SIM.');
                    sfx.teleport();
                });
            });
        }
    },
    {
        name: 'A FORNALHA',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            addSolid(600, 480, 1000, 30);
            addDoor(1490);
            addSign(200, 655, 'OLHE PARA CIMA E PARA BAIXO');

            addCrusher(450, 0.9);
            addCrusher(950, 1.7);

            const traps = [
                { x: 720, phase: 0 },
                { x: 1220, phase: 1.2 }
            ];

            traps.forEach((trap) => {
                const spike = addSpikes(trap.x, 510, 90, 260, 'down', { hidden: true, speed: 1200 });
                const cycle = 2.4;

                addScript(() => {
                    const time = (world.diffT + trap.phase) % cycle;
                    const down = time > 0.9 && time < 1.8;
                    spike.warning = time > 0.6 && time < 0.9;
                    spike.targetOffset = down ? 0 : -260;
                });
            });
        }
    },
    {
        name: 'CHUVA FINAL',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const door = addDoor(1490, { locked: true });
            addSign(220, 655, 'AGUENTE 6 SEGUNDOS');
            const noExitSign = addSign(1180, 655, 'SEM SAÍDA');

            world.countdown = 6;
            world.nextMeteor = 0.5;

            const spike1 = addSpikes(720, FLOOR_Y - 44, 90, 44, 'up', { hidden: true });
            const spike2 = addSpikes(1080, FLOOR_Y - 44, 90, 44, 'up', { hidden: true });

            once('rainSpikeOne', (p) => p.x > 600, () => {
                popSpikes(spike1);
                sfx.trap();
            });

            once('rainSpikeTwo', (p) => p.x > 960, () => {
                popSpikes(spike2);
                sfx.trap();
            });

            addScript(() => {
                if (!world.flags.rainDone) {
                    world.countdown = Math.max(0, 6 - world.t);
                    if (world.t >= 6) {
                        world.flags.rainDone = true;
                        world.countdown = 0;
                        door.locked = false;
                        noExitSign.text = 'CORRE!';
                        msg('A PORTA ABRIU!');
                        sfx.teleport();
                    } else if (world.t >= world.nextMeteor) {
                        world.nextMeteor = world.t + 0.55 / world.difficulty;
                        spawnMeteor();
                    }
                }
            });
        }
    },
    {
        name: 'FUGA DO DEVIL',
        build() {
            addSolid(0, FLOOR_Y, GAME_W, 130);
            const realDoor = addDoor(1520, { hidden: true });
            const fakeDoor = addFakeDoor(1400);
            addSign(250, 655, 'NÃO OLHE PARA TRÁS');

            const spike1 = addSpikes(620, FLOOR_Y - 44, 100, 44, 'up', { hidden: true });
            const spike2 = addSpikes(960, FLOOR_Y - 44, 100, 44, 'up', { hidden: true });

            once('fleeSpikeOne', (p) => p.x > 430, () => {
                popSpikes(spike1);
                sfx.trap();
            });

            once('fleeSpikeTwo', (p) => p.x > 770, () => {
                popSpikes(spike2);
                sfx.trap();
            });

            once('fleeFakeDoor', (p) => p.x > 1260, () => {
                fakeDoor.active = false;
                burst(fakeDoor.x + fakeDoor.w / 2, fakeDoor.y + fakeDoor.h / 2, '#f2f0ea', 30, 560, { gravity: 1200, size: 6 });
                realDoor.hidden = false;
                burst(realDoor.x + realDoor.w / 2, realDoor.y + realDoor.h / 2, '#f2f0ea', 22, 420, { gravity: 150 });
                msg('ERA FALSA! A VERDADEIRA É ALI.');
                sfx.trap();
                shake(10, 0.35);
            });

            addScript(() => {
                if (world.t > 1.4 && !world.chaseWall) {
                    world.chaseWall = { x: -380, speed: 200 };
                    msg('ELE ESTÁ VINDO. CORRE!');
                    shake(12, 0.5);
                    sfx.teleport();
                }
            });
        }
    }
];

const MAP_LAYOUTS = [
    {
        doors: [
            { x: 170, y: 560 }, { x: 400, y: 390 }, { x: 630, y: 600 },
            { x: 870, y: 380 }, { x: 1100, y: 560 }
        ],
        portal: { x: 1395, y: 370 }
    },
    {
        doors: [
            { x: 180, y: 410 }, { x: 420, y: 610 }, { x: 650, y: 420 },
            { x: 890, y: 620 }, { x: 1120, y: 410 }
        ],
        portal: { x: 1400, y: 560 }
    },
    {
        doors: [
            { x: 160, y: 620 }, { x: 390, y: 420 }, { x: 620, y: 610 },
            { x: 860, y: 370 }, { x: 1090, y: 560 }
        ],
        portal: { x: 1390, y: 390 }
    },
    {
        doors: [
            { x: 200, y: 560 }, { x: 430, y: 380 }, { x: 660, y: 600 },
            { x: 900, y: 380 }, { x: 1130, y: 590 }
        ],
        portal: { x: 1405, y: 400 }
    },
    {
        doors: [
            { x: 170, y: 430 }, { x: 400, y: 620 }, { x: 640, y: 430 },
            { x: 880, y: 610 }, { x: 1120, y: 430 }
        ],
        portal: { x: 1410, y: 600 }
    }
];

/* ------------------------------------------------------------------
   Carregamento de fase
------------------------------------------------------------------ */

function difficultyForLevel(index) {
    return 1 + index * 0.018 + (game.worldIndex || 0) * 0.22;
}

function makeWorld(index) {
    return {
        index,
        name: LEVELS[index].name,
        t: 0,
        diffT: 0,
        difficulty: difficultyForLevel(index),
        solids: [],
        spikes: [],
        crushers: [],
        projectiles: [],
        signs: [],
        triggers: [],
        timers: [],
        scripts: [],
        fakeDoors: [],
        door: null,
        spawn: { x: 130, y: FLOOR_Y - PLAYER_H },
        killY: 1000,
        dark: false,
        invertControls: false,
        countdown: 0,
        chaseWall: null,
        world2: false,
        lasers: [],
        fireJets: [],
        saws: [],
        rocks: [],
        nextRock: 0,
        flags: {}
    };
}

function loadLevel(index, opts = {}) {
    game.levelIndex = index;
    world = makeWorld(index);
    particles = [];
    hideBanner();
    clearWorldTransition();
    hideElement('world-map');
    hideElement('chapter-screen');

    LEVELS[index].build();

    if ((game.worldIndex || 0) > 0) {
        applyWorld2Mods(index);
    }

    player.x = world.spawn.x;
    player.y = world.spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.ground = null;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.facing = 1;
    player.squash = 0;
    player.runCycle = 0;
    player.dead = false;

    game.phase = 'play';
    game.paused = false;
    game.deathTimer = 0;
    game.clearTimer = 0;
    game.flash = 0;
    game.shakeT = 0;
    game.lastHudSecond = -1;

    hideElement('pause-screen');
    hideElement('victory-screen');
    hideElement('chapter-screen');
    hideElement('world-map');

    updateHudLevel();
    updateHudDeaths();
    updateHudClock();

    if (!opts.silent) {
        const title = 'FASE ' + pad2(index + 1) + ' — ' + LEVELS[index].name;
        showBanner(title, 'white', 1500);
    }

    updateTouchVisibility();
}

function updateHudLevel() {
    const el = $('hud-level');
    if (el) {
        el.innerHTML = 'MUNDO ' + pad2((game.worldIndex || 0) + 1) +
            ' <span>•</span> FASE ' + pad2(game.levelIndex + 1) +
            ' / ' + pad2(LEVELS.length);
    }
    const name = $('hud-name');
    if (name) name.textContent = LEVELS[game.levelIndex].name;
    const difficulty = $('hud-difficulty');
    if (difficulty) {
        const value = world ? world.difficulty : difficultyForLevel(game.levelIndex);
        difficulty.textContent = 'DIFICULDADE ×' + value.toFixed(2);
    }
}

function updateHudDeaths() {
    const el = $('hud-deaths');
    if (!el) return;
    el.textContent = game.deaths;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
}

function formatTime(seconds) {
    const total = Math.floor(seconds);
    return pad2(Math.floor(total / 60)) + ':' + pad2(total % 60);
}

function updateHudClock() {
    if (game.screen !== 'game') return;
    const second = Math.floor(game.runTime);
    if (second === game.lastHudSecond) return;
    game.lastHudSecond = second;
    const el = $('hud-time');
    if (el) el.textContent = formatTime(game.runTime);
}

/* ------------------------------------------------------------------
   Fluxo de telas
------------------------------------------------------------------ */

function startGame() {
    sfx.init();

    game.screen = 'game';
    game.phase = 'play';
    game.paused = false;
    game.deaths = 0;
    game.runTime = 0;
    game.lastHudSecond = -1;
    game.worldIndex = 0;
    game.completed = 0;
    game.worldMapIndex = 0;

    clearWorldTransition();
    hideElement('intro-splash');
    hideElement('start-menu');
    hideElement('tutorial-modal');
    hideElement('pause-screen');
    hideElement('victory-screen');
    hideElement('chapter-screen');
    hideElement('world-map');
    hideElement('touch-controls');
    hideBanner();

    const hud = $('hud');
    if (hud) hud.classList.remove('hidden');
    document.body.classList.add('playing');

    updateSoundButton();
    updateHudDeaths();
    loadLevel(0);
}

function openMenu() {
    game.screen = 'menu';
    game.phase = 'idle';
    game.paused = false;
    world = null;
    particles = [];
    clearInput();
    clearWorldTransition();

    hideElement('intro-splash');
    hideElement('tutorial-modal');
    hideElement('pause-screen');
    hideElement('victory-screen');
    hideElement('chapter-screen');
    hideElement('world-map');
    hideElement('hud');
    hideElement('touch-controls');
    hideBanner();

    const menu = $('start-menu');
    if (menu) menu.classList.remove('hidden');
    document.body.classList.remove('playing');
}

function enterMenu() {
    if (game.screen !== 'intro') return;
    openMenu();
}

function showIntro() {
    game.screen = 'intro';
    game.phase = 'idle';
    game.paused = false;
    game.deaths = 0;
    game.runTime = 0;
    game.lastHudSecond = -1;
    world = null;
    particles = [];
    clearInput();
    clearWorldTransition();

    hideElement('start-menu');
    hideElement('tutorial-modal');
    hideElement('pause-screen');
    hideElement('victory-screen');
    hideElement('chapter-screen');
    hideElement('world-map');
    hideElement('hud');
    hideElement('touch-controls');
    hideBanner();

    const intro = $('intro-splash');
    if (intro) intro.classList.remove('hidden');
    document.body.classList.remove('playing');
}

/* ------------------------------------------------------------------
   Mapa de fases
------------------------------------------------------------------ */

function buildMapPath(points) {
    let d = 'M ' + points[0].x + ' ' + points[0].y;
    for (let i = 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const curve = Math.max(70, Math.abs(p1.x - p0.x) * 0.45);
        d += ' C ' + (p0.x + curve) + ' ' + p0.y + ', ' + (p1.x - curve) + ' ' + p1.y + ', ' + p1.x + ' ' + p1.y;
    }
    return d;
}

function buildMapJaggedPath() {
    let d = 'M0 60 L0 28';
    for (let x = 0; x < 1600; x += 40) {
        const peak = (x / 40) % 2 === 0 ? 4 : 18;
        d += ' L' + (x + 20) + ' ' + peak + ' L' + (x + 40) + ' 28';
    }
    return d + ' L1600 60 Z';
}

function mapMessage(text) {
    const el = $('map-message');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    if (mapMessageTimeout) clearTimeout(mapMessageTimeout);
    mapMessageTimeout = setTimeout(() => el.classList.remove('show'), 1500);
}

function renderWorldMap(worldIndex) {
    const layout = MAP_LAYOUTS[worldIndex % MAP_LAYOUTS.length];
    const map = $('world-map');
    if (map) map.dataset.world = String(worldIndex + 1);

    $('map-world').textContent = 'MUNDO ' + (worldIndex + 1);
    $('map-range').textContent = 'FASES ' + pad2(worldIndex * 5 + 1) + ' — ' + pad2(worldIndex * 5 + 5);
    $('map-deaths').textContent = game.deaths;
    $('map-time').textContent = formatTime(game.runTime);
    $('map-progress').textContent = Math.min(game.completed, LEVELS.length) + ' / ' + LEVELS.length;

    const nextLevelIndex = Math.min(game.completed, LEVELS.length - 1);
    $('map-diff').textContent = '×' + difficultyForLevel(nextLevelIndex).toFixed(2);

    const doorsRoot = $('map-doors');
    doorsRoot.innerHTML = '';
    const points = [];

    for (let i = 0; i < 5; i++) {
        const levelIndex = worldIndex * 5 + i;
        const position = layout.doors[i];
        const done = levelIndex < game.completed;
        const current = levelIndex === game.completed;
        const stateClass = done ? 'done' : current ? 'current' : 'locked';
        const stateLabel = done ? 'FEITA' : current ? 'JOGAR' : 'BLOQUEADA';

        const door = document.createElement('button');
        door.type = 'button';
        door.className = 'map-door ' + stateClass;
        door.style.left = (position.x / 1600 * 100) + '%';
        door.style.top = (position.y / 900 * 100) + '%';
        door.setAttribute(
            'aria-label',
            'Fase ' + (levelIndex + 1) + (done ? ' concluída' : current ? ' disponível' : ' bloqueada')
        );
        door.innerHTML =
            '<span class="door-body">' +
                '<span class="door-num">' + pad2(levelIndex + 1) + '</span>' +
                '<span class="door-state">' + stateLabel + '</span>' +
            '</span>' +
            '<span class="door-arrow">▼</span>';
        door.addEventListener('click', () => handleMapDoor(levelIndex));
        doorsRoot.appendChild(door);
        points.push(position);
    }

    const portal = $('map-portal');
    portal.style.left = (layout.portal.x / 1600 * 100) + '%';
    portal.style.top = (layout.portal.y / 900 * 100) + '%';

    const worldComplete = game.completed >= (worldIndex + 1) * 5;
    const final = worldIndex === MAP_LAYOUTS.length - 1;
    const worldProgress = clamp(game.completed - worldIndex * 5, 0, 5);
    portal.classList.toggle('locked', !worldComplete);
    portal.classList.toggle('active', worldComplete);
    portal.classList.toggle('final', final);
    $('map-portal-label').textContent = final && worldComplete
        ? 'O FIM'
        : worldComplete
            ? 'ABRIR PORTAL'
            : 'PORTAL BLOQUEADO';
    $('map-portal-count').textContent = worldProgress + ' / 5 FASES';

    points.push(layout.portal);
    const path = buildMapPath(points);
    $('map-path-thick').setAttribute('d', path);
    $('map-path-dash').setAttribute('d', path);
    $('map-jag-path').setAttribute('d', buildMapJaggedPath());

    const mapMessageEl = $('map-message');
    if (mapMessageEl) mapMessageEl.classList.remove('show');
}

function openWorldMap(worldIndex) {
    game.screen = 'map';
    game.phase = 'idle';
    game.paused = false;
    game.worldMapIndex = worldIndex;
    world = null;
    particles = [];
    clearInput();

    hideElement('intro-splash');
    hideElement('start-menu');
    hideElement('tutorial-modal');
    hideElement('pause-screen');
    hideElement('victory-screen');
    hideElement('chapter-screen');
    hideElement('hud');
    hideElement('touch-controls');
    hideBanner();

    document.body.classList.remove('playing');

    renderWorldMap(worldIndex);
    const map = $('world-map');
    if (map) map.classList.remove('hidden');
    updateSoundButton();
}

function startLevelFromMap(levelIndex) {
    if (game.screen !== 'map') return;

    sfx.init();
    hideElement('world-map');
    game.screen = 'game';
    game.phase = 'play';
    game.paused = false;

    document.body.classList.add('playing');
    const hud = $('hud');
    if (hud) hud.classList.remove('hidden');

    loadLevel(levelIndex);
}

function handleMapDoor(levelIndex) {
    if (game.screen !== 'map') return;
    if (levelIndex > game.completed) {
        mapMessage('FASE BLOQUEADA. VENÇA AS ANTERIORES.');
        return;
    }
    sfx.init();
    sfx.teleport();
    startLevelFromMap(levelIndex);
}

function handleMapPortal() {
    if (game.screen !== 'map') return;

    const worldIndex = game.worldMapIndex;
    const worldComplete = game.completed >= (worldIndex + 1) * 5;
    if (!worldComplete) {
        const remaining = 5 - clamp(game.completed - worldIndex * 5, 0, 5);
        mapMessage('FALTAM ' + remaining + ' FASE' + (remaining === 1 ? '' : 'S') + ' PARA ABRIR O PORTAL.');
        return;
    }

    sfx.init();
    sfx.teleport();

    if (worldIndex >= MAP_LAYOUTS.length - 1) {
        hideElement('world-map');
        showVictory();
        return;
    }

    openWorldMap(worldIndex + 1);
}

function goMenu() {
    game.deaths = 0;
    game.runTime = 0;
    game.lastHudSecond = -1;
    openMenu();
}

function pauseGame() {
    if (game.screen !== 'game' || game.paused || game.phase !== 'play') return;
    game.paused = true;
    const el = $('pause-screen');
    if (el) el.classList.remove('hidden');
    updateTouchVisibility();
}

function resumeGame() {
    if (!game.paused) return;
    game.paused = false;
    hideElement('pause-screen');
    updateTouchVisibility();
}

function restartLevel() {
    if (game.screen !== 'game') return;
    game.paused = false;
    hideElement('pause-screen');
    loadLevel(game.levelIndex, { silent: true });
    showBanner('FASE REINICIADA', 'white', 900);
}

function showVictory() {
    game.phase = 'victory';
    game.paused = false;

    clearWorldTransition();
    hideElement('world-map');
    hideElement('chapter-screen');

    const timeEl = $('vic-time');
    if (timeEl) timeEl.textContent = formatTime(game.runTime);
    const deathsEl = $('vic-deaths');
    if (deathsEl) deathsEl.textContent = game.deaths;
    const levelsEl = $('vic-levels');
    if (levelsEl) levelsEl.textContent = LEVELS.length * TOTAL_WORLDS;

    hideElement('touch-controls');
    const victory = $('victory-screen');
    if (victory) victory.classList.remove('hidden');
}

/* ------------------------------------------------------------------
   Banners / UI
------------------------------------------------------------------ */

function showBanner(text, tone = 'red', duration = 1900) {
    const el = $('banner');
    if (!el) return;
    el.textContent = text;
    el.className = 'show' + (tone === 'white' ? ' white' : '');
    if (bannerTimeout) clearTimeout(bannerTimeout);
    bannerTimeout = setTimeout(() => {
        el.classList.remove('show');
    }, duration);
}

function hideBanner() {
    const el = $('banner');
    if (el) el.classList.remove('show');
    if (bannerTimeout) {
        clearTimeout(bannerTimeout);
        bannerTimeout = null;
    }
}

function hideElement(id) {
    const el = $(id);
    if (el) el.classList.add('hidden');
}

function openTutorial() {
    const el = $('tutorial-modal');
    if (el) el.classList.remove('hidden');
}

function closeTutorial() {
    hideElement('tutorial-modal');
}

function toggleSound() {
    game.soundOn = !game.soundOn;
    sfx.setEnabled(game.soundOn);
    updateSoundButton();
}

function updateSoundButton() {
    const btn = $('btn-sound');
    if (btn) {
        btn.textContent = game.soundOn ? 'SOM' : 'MUDO';
        btn.setAttribute('aria-pressed', game.soundOn ? 'true' : 'false');
        btn.title = game.soundOn ? 'Silenciar (M)' : 'Ativar som (M)';
    }

    const mapBtn = $('map-sound');
    if (mapBtn) {
        mapBtn.textContent = game.soundOn ? 'SOM' : 'MUDO';
        mapBtn.setAttribute('aria-pressed', game.soundOn ? 'true' : 'false');
    }
}

function updateTouchVisibility() {
    const el = $('touch-controls');
    if (!el) return;
    const tutorialOpen = !$('tutorial-modal').classList.contains('hidden');
    const show = IS_TOUCH && game.screen === 'game' && game.phase === 'play' && !game.paused && !tutorialOpen;
    el.classList.toggle('hidden', !show);
}

/* ------------------------------------------------------------------
   Atualização da lógica
------------------------------------------------------------------ */

function update(dt) {
    game.shakeT = Math.max(0, game.shakeT - dt);
    game.flash = Math.max(0, game.flash - dt * 1.8);

    if (game.phase === 'dying') {
        game.deathTimer -= dt;
        updateParticles(dt);
        if (game.deathTimer <= 0) respawn();
        return;
    }

    if (game.phase === 'clear') {
        game.clearTimer -= dt;
        updateParticles(dt);
        if (game.clearTimer <= 0) advanceLevel();
        return;
    }

    if (game.phase !== 'play') return;

    game.runTime += dt;
    world.t += dt;
    world.diffT += dt * world.difficulty;

    for (const timer of world.timers) {
        if (!timer.done && world.t >= timer.at) {
            timer.done = true;
            timer.fn();
        }
    }

    updateSolids(dt);
    updateSpikes(dt);
    updateCrushers(dt);
    updateProjectiles(dt);
    updateWorld2Hazards(dt);

    if (world.chaseWall) {
        world.chaseWall.x += world.chaseWall.speed * world.difficulty * dt;
    }

    for (const script of world.scripts) {
        script(dt);
    }

    updatePlayer(dt);

    for (const trigger of world.triggers) {
        if (!trigger.done && trigger.test(player)) {
            trigger.done = true;
            trigger.fn();
        }
    }

    checkDoor();
    checkHazards();
    updateParticles(dt);
}

function updateSolids(dt) {
    for (const solid of world.solids) {
        if (!solid.active) continue;

        const prevX = solid.x;
        const prevY = solid.y;

        if (solid.move) {
            const platformSpeed = 1 + (world.difficulty - 1) * 0.6;
            solid.phase += solid.move.speed * platformSpeed * dt;
            if (solid.move.axis === 'x') {
                solid.x = solid.originX + Math.sin(solid.phase) * solid.move.amp;
            } else {
                solid.y = solid.originY + Math.sin(solid.phase) * solid.move.amp;
            }
        }

        if (solid.falling) {
            if (solid.state === 'idle' && player.ground === solid) {
                solid.state = 'shake';
                solid.timer = 0.22;
                sfx.crumble();
            }
            if (solid.state === 'shake') {
                solid.timer -= dt;
                if (solid.timer <= 0) {
                    solid.state = 'fall';
                    solid.vy = 120;
                }
            }
            if (solid.state === 'fall') {
                solid.vy += GRAVITY * 0.7 * dt;
                solid.y += solid.vy * dt;
                if (solid.y > GAME_H + 140) solid.active = false;
            }
        }

        if (solid.crumble) {
            if (solid.state === 'idle' && player.ground === solid) {
                solid.state = 'shake';
                solid.timer = 0.38;
                shake(2, 0.12);
                sfx.crumble();
            }
            if (solid.state === 'shake') {
                solid.timer -= dt;
                if (solid.timer <= 0) {
                    solid.state = 'gone';
                    solid.active = false;
                    burst(solid.x + solid.w / 2, solid.y + solid.h / 2, '#e7e4da', 18, 320, {
                        gravity: 900,
                        size: 7
                    });
                    shake(4, 0.18);
                }
            }
        }

        const dx = solid.x - prevX;
        const dy = solid.y - prevY;
        if ((dx !== 0 || dy !== 0) && player.ground === solid) {
            player.x += dx;
            player.y += dy;
        }
    }
}

function updateSpikes(dt) {
    for (const spike of world.spikes) {
        if (!spike.active) continue;
        if (spike.delay > 0) {
            spike.delay -= dt;
        } else {
            spike.offset = approach(spike.offset, spike.targetOffset, spike.speed * world.difficulty * dt);
        }
    }
}

function updateCrushers(dt) {
    const difficulty = world.difficulty;

    for (const crusher of world.crushers) {
        crusher.timer -= dt * difficulty;

        if (crusher.state === 'idle') {
            crusher.y = crusher.restY;
            if (crusher.timer <= 0) {
                crusher.state = 'warn';
                crusher.timer = 0.5;
                sfx.trap();
            }
        } else if (crusher.state === 'warn') {
            crusher.y = crusher.restY;
            if (crusher.timer <= 0) {
                crusher.state = 'fall';
                crusher.vy = 0;
            }
        } else if (crusher.state === 'fall') {
            crusher.vy += 7000 * difficulty * dt;
            crusher.y += crusher.vy * dt;
            if (crusher.y >= crusher.slamY) {
                crusher.y = crusher.slamY;
                crusher.state = 'hold';
                crusher.timer = 0.35;
                shake(14, 0.3);
                sfx.crusher();
                burst(crusher.x + crusher.w / 2, crusher.slamY + crusher.h - 6, '#e7e4da', 18, 420, {
                    gravity: 1200,
                    size: 6
                });
            }
        } else if (crusher.state === 'hold') {
            if (crusher.timer <= 0) crusher.state = 'rise';
        } else if (crusher.state === 'rise') {
            crusher.y -= 750 * difficulty * dt;
            if (crusher.y <= crusher.restY) {
                crusher.y = crusher.restY;
                crusher.state = 'idle';
                crusher.timer = 1.0;
            }
        }
    }
}

function updateProjectiles(dt) {
    const fallScale = 0.85 + world.difficulty * 0.15;

    for (const proj of world.projectiles) {
        if (proj.warn > 0) {
            proj.warn -= dt;
            if (proj.warn <= 0) proj.vy = 520;
            continue;
        }

        proj.vy += 2400 * fallScale * dt;
        proj.y += proj.vy * dt;
        proj.spin += dt * 8;

        if (proj.y > FLOOR_Y - 16) {
            proj.dead = true;
            burst(proj.x, FLOOR_Y - 10, '#e5484d', 18, 380, { gravity: 1000, size: 6 });
            shake(7, 0.2);
            sfx.crusher();
        }
    }

    world.projectiles = world.projectiles.filter((proj) => !proj.dead);
}

function updateWorld2Hazards(dt) {
    if (!world.world2) return;

    const cycleTime = world.diffT;

    for (const laser of world.lasers) {
        const t = (cycleTime + laser.phase) % laser.cycle;
        laser.state = t < 0.9 ? 'off' : t < 1.2 ? 'warn' : t < 2.2 ? 'on' : 'off';
    }

    for (const jet of world.fireJets) {
        const t = (cycleTime + jet.phase) % jet.cycle;
        jet.state = t < 0.45 ? 'off' : t < 0.75 ? 'warn' : t < 1.75 ? 'on' : 'off';
    }

    for (const saw of world.saws) {
        saw.angle = (saw.angle + dt * 12) % (Math.PI * 2);
        saw.x = saw.baseX + Math.sin(cycleTime * saw.speed + saw.phase) * saw.amp;
    }

    for (const rock of world.rocks) {
        if (rock.warn > 0) {
            rock.warn -= dt;
            if (rock.warn <= 0) rock.vy = 260;
            continue;
        }

        rock.vy += 2600 * dt;
        rock.y += rock.vy * dt;
        rock.spin += dt * 6;

        if (rock.y > FLOOR_Y - 18) {
            rock.dead = true;
            burst(rock.x, FLOOR_Y - 8, '#ffb36b', 14, 320, { gravity: 1000, size: 6 });
            shake(6, 0.18);
            sfx.crusher();
        }
    }

    world.rocks = world.rocks.filter((rock) => !rock.dead);

    if (world.t >= world.nextRock) {
        spawnRock();
        world.nextRock = world.t + 3.2 / world.difficulty;
    }
}

function updatePlayer(dt) {
    const p = player;

    p.coyote = p.onGround ? COYOTE_TIME : Math.max(0, p.coyote - dt);
    p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

    let dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (world.invertControls) dir *= -1;
    if (dir !== 0) {
        p.vx += dir * ACCEL * dt;
        p.vx = clamp(p.vx, -MOVE_SPEED, MOVE_SPEED);
        p.facing = dir;
    } else {
        const frictionStep = FRICTION * dt;
        if (Math.abs(p.vx) <= frictionStep) p.vx = 0;
        else p.vx -= Math.sign(p.vx) * frictionStep;
    }

    if (p.jumpBuffer > 0 && p.coyote > 0) {
        p.vy = JUMP_VELOCITY;
        p.onGround = false;
        p.ground = null;
        p.coyote = 0;
        p.jumpBuffer = 0;
        p.squash = -0.18;
        sfx.jump();
        burst(p.x + p.w / 2, p.y + p.h - 2, 'rgba(242,240,234,0.55)', 7, 160, {
            gravity: 300,
            size: 4
        });
    }

    if (!input.jump && p.vy < JUMP_CUT) {
        p.vy = JUMP_CUT;
    }

    p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);

    const wasOnGround = p.onGround;
    const fallSpeed = p.vy;

    p.x += p.vx * dt;
    resolveHorizontal();

    p.y += p.vy * dt;
    p.onGround = false;
    p.ground = null;
    resolveVertical();

    if (p.onGround) {
        p.coyote = COYOTE_TIME;
        if (!wasOnGround && fallSpeed > 520) {
            p.squash = 0.26;
            sfx.land();
            burst(p.x + p.w / 2, p.y + p.h, 'rgba(242,240,234,0.45)', 8, 180, {
                gravity: 350,
                size: 5
            });
        }
    }

    p.x = clamp(p.x, 0, GAME_W - p.w);
    p.runCycle += (Math.abs(p.vx) / MOVE_SPEED) * dt * 20;
    p.squash = approach(p.squash, 0, dt * 4);
}

function resolveHorizontal() {
    const p = player;

    for (const solid of world.solids) {
        if (!solid.active || solid.noCollide) continue;
        if (!overlap(p, solid)) continue;

        if (p.vx > 0) {
            p.x = solid.x - p.w;
        } else if (p.vx < 0) {
            p.x = solid.x + solid.w;
        } else {
            const playerCenter = p.x + p.w / 2;
            const solidCenter = solid.x + solid.w / 2;
            p.x = playerCenter < solidCenter ? solid.x - p.w : solid.x + solid.w;
        }
        p.vx = 0;
    }
}

function resolveVertical() {
    const p = player;

    for (const solid of world.solids) {
        if (!solid.active || solid.noCollide) continue;
        if (!overlap(p, solid)) continue;

        if (p.vy > 0) {
            p.y = solid.y - p.h;
            p.vy = 0;
            p.onGround = true;
            p.ground = solid;
        } else if (p.vy < 0) {
            p.y = solid.y + solid.h;
            p.vy = 0;
        } else {
            const playerCenter = p.y + p.h / 2;
            const solidCenter = solid.y + solid.h / 2;
            if (playerCenter < solidCenter) {
                p.y = solid.y - p.h;
                p.onGround = true;
                p.ground = solid;
            } else {
                p.y = solid.y + solid.h;
            }
        }
    }
}

function checkDoor() {
    const door = world.door;
    if (!door || door.hidden || door.locked) return;

    const hitbox = {
        x: door.x + 12,
        y: door.y + 8,
        w: door.w - 24,
        h: door.h - 8
    };

    if (overlap(player, hitbox)) {
        winLevel();
    }
}

function checkHazards() {
    for (const spike of world.spikes) {
        if (!spike.active || spike.harmless) continue;
        if (overlap(player, spikeHitbox(spike))) {
            die();
            return;
        }
    }

    for (const crusher of world.crushers) {
        if (crusher.state !== 'fall' && crusher.state !== 'hold') continue;
        if (overlap(player, { x: crusher.x + 4, y: crusher.y, w: crusher.w - 8, h: crusher.h })) {
            die();
            return;
        }
    }

    for (const proj of world.projectiles) {
        if (proj.warn > 0) continue;
        if (overlap(player, { x: proj.x - 19, y: proj.y, w: 38, h: 42 })) {
            die();
            return;
        }
    }

    if (world.world2) {
        for (const laser of world.lasers) {
            if (laser.state === 'on' && overlap(player, {
                x: laser.x - laser.width / 2,
                y: laser.top,
                w: laser.width,
                h: FLOOR_Y - laser.top
            })) {
                die();
                return;
            }
        }

        for (const jet of world.fireJets) {
            if (jet.state === 'on' && overlap(player, {
                x: jet.x - jet.width / 2,
                y: FLOOR_Y - jet.height,
                w: jet.width,
                h: jet.height
            })) {
                die();
                return;
            }
        }

        for (const saw of world.saws) {
            const padding = 20;
            if (overlap(player, {
                x: saw.x - padding,
                y: saw.y - padding,
                w: padding * 2,
                h: padding * 2
            })) {
                die();
                return;
            }
        }

        for (const rock of world.rocks) {
            if (rock.warn > 0) continue;
            if (overlap(player, {
                x: rock.x - rock.w / 2,
                y: rock.y,
                w: rock.w,
                h: rock.h
            })) {
                die();
                return;
            }
        }
    }

    if (world.chaseWall) {
        const front = world.chaseWall.x + 230;
        if (player.x < front) {
            die();
            return;
        }
    }

    if (player.y > world.killY) {
        die();
    }
}

function spikeHitbox(spike) {
    let x = spike.x;
    let y = spike.y;

    if (spike.dir === 'up' || spike.dir === 'down') {
        y += spike.offset;
    } else {
        x += spike.offset;
    }

    return {
        x: x + 6,
        y: y + 6,
        w: spike.w - 12,
        h: spike.h - 12
    };
}

function die() {
    if (game.phase !== 'play') return;

    game.phase = 'dying';
    game.deathTimer = 0.85;
    game.deaths += 1;
    game.flash = 0.5;
    shake(16, 0.4);
    sfx.death();
    player.dead = true;

    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    burst(cx, cy, '#f2f0ea', 26, 520, { gravity: 1500, size: 7 });
    burst(cx, cy, '#e5484d', 14, 420, { gravity: 1300, size: 5 });

    updateHudDeaths();
    updateTouchVisibility();
}

function respawn() {
    loadLevel(game.levelIndex, { silent: true });
    const lines = [
        'TENTE DE NOVO.',
        'ISSO FOI INTENCIONAL.',
        'A CULPA É DO NÍVEL.',
        'QUASE.',
        'O DEVIL RI.',
        'MORRER FAZ PARTE.'
    ];
    showBanner(lines[Math.floor(Math.random() * lines.length)], 'red', 1200);
    game.lastHudSecond = Math.floor(game.runTime);
}

function winLevel() {
    if (game.phase !== 'play') return;

    game.phase = 'clear';
    game.clearTimer = 0.95;
    sfx.win();
    shake(3, 0.2);

    const door = world.door;
    if (door) {
        burst(door.x + door.w / 2, door.y + door.h / 2, '#f2c14e', 20, 420, { gravity: 400, size: 5 });
        burst(door.x + door.w / 2, door.y + door.h / 2, '#f2f0ea', 12, 300, { gravity: 300, size: 4 });
    }

    showBanner('FASE COMPLETA', 'white', 900);
    updateTouchVisibility();
}

function showChapterScreen(completed) {
    game.phase = 'chapter';
    game.pendingLevel = completed < LEVELS.length ? completed : null;

    const chapter = Math.ceil(completed / 5);
    const final = completed >= LEVELS.length;
    const modal = $('chapter-modal');
    if (modal) modal.classList.toggle('is-final', final);

    $('chapter-kicker').textContent = 'CAPÍTULO ' + chapter + ' CONCLUÍDO';
    $('chapter-deaths').textContent = game.deaths;
    $('chapter-time').textContent = formatTime(game.runTime);
    $('chapter-progress').textContent = completed + ' / ' + LEVELS.length;

    if (final) {
        $('chapter-title').textContent = 'O ÚLTIMO PORTAL';
        $('chapter-sub').textContent = 'TODOS OS ' + LEVELS.length + ' DESAFIOS VENCIDOS';
        $('chapter-call').textContent = 'O Devil não gostou. Mas agora é tarde.';
        $('portal-label').textContent = 'ATRAVESSAR PARA O FIM';
        $('chapter-hint').textContent = 'CLIQUE NO PORTAL PARA VER O RESULTADO';
    } else {
        const nextChapter = chapter + 1;
        const start = completed + 1;
        const end = Math.min(completed + 5, LEVELS.length);
        $('chapter-title').textContent = 'MUNDO ' + nextChapter;
        $('chapter-sub').textContent = 'FASES ' + pad2(start) + ' — ' + pad2(end);
        $('chapter-call').textContent = 'O próximo mundo está mais rápido. E mais cruel.';
        $('portal-label').textContent = 'ATRAVESSAR O PORTAL';
        $('chapter-hint').textContent = 'CLIQUE NO PORTAL PARA CONTINUAR';
    }

    const nextIndex = game.pendingLevel;
    const nextDifficulty = nextIndex !== null
        ? difficultyForLevel(nextIndex)
        : difficultyForLevel(LEVELS.length - 1);

    $('chapter-diff').textContent = '×' + nextDifficulty.toFixed(2);
    $('chapter-diff-fill').style.width = Math.round((completed / LEVELS.length) * 100) + '%';

    hideBanner();
    hideElement('hud');
    const screen = $('chapter-screen');
    if (screen) screen.classList.remove('hidden');
    updateTouchVisibility();
}

function enterPortal() {
    if (game.phase !== 'chapter') return;

    sfx.teleport();
    hideElement('chapter-screen');

    const next = game.pendingLevel;
    game.pendingLevel = null;

    if (next === null || next >= LEVELS.length) {
        showVictory();
        return;
    }

    const hud = $('hud');
    if (hud) hud.classList.remove('hidden');
    loadLevel(next);
}

function clearWorldTransition() {
    if (worldTransitionTimer) {
        clearTimeout(worldTransitionTimer);
        worldTransitionTimer = null;
    }
    hideElement('world-transition');
}

function beginWorld(worldIndex) {
    game.worldIndex = worldIndex;
    game.phase = 'world';
    game.paused = true;

    hideBanner();
    hideElement('hud');
    hideElement('touch-controls');
    document.body.classList.remove('playing');

    $('world-kicker').textContent = 'MUNDO ' + worldIndex + ' CONCLUÍDO';
    $('world-title').textContent = 'MUNDO ' + (worldIndex + 1);
    $('world-sub').textContent = worldIndex === 1
        ? 'O INFERNO • 25 FASES • NOVOS DESAFIOS'
        : 'MAIS ' + LEVELS.length + ' FASES • DIFICULDADE AUMENTADA';

    const card = document.querySelector('.world-card');
    if (card) card.classList.toggle('inferno', worldIndex > 0);

    const overlay = $('world-transition');
    if (overlay) overlay.classList.remove('hidden');

    const barFill = overlay ? overlay.querySelector('.world-bar i') : null;
    if (barFill) {
        barFill.style.animation = 'none';
        void barFill.offsetWidth;
        barFill.style.animation = '';
    }

    if (worldTransitionTimer) clearTimeout(worldTransitionTimer);
    worldTransitionTimer = setTimeout(() => {
        worldTransitionTimer = null;
        hideElement('world-transition');
        game.paused = false;
        document.body.classList.add('playing');
        const hud = $('hud');
        if (hud) hud.classList.remove('hidden');
        loadLevel(0);
    }, 2200);
}

function advanceLevel() {
    const next = game.levelIndex + 1;

    if (next < LEVELS.length) {
        loadLevel(next);
        return;
    }

    if (game.worldIndex + 1 < TOTAL_WORLDS) {
        beginWorld(game.worldIndex + 1);
    } else {
        showVictory();
    }
}

/* ------------------------------------------------------------------
   Renderização
------------------------------------------------------------------ */

function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (game.screen !== 'game' || !world) return;

    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, GAME_W, GAME_H);
    ctx.clip();

    let shakeX = 0;
    let shakeY = 0;
    if (game.shakeT > 0) {
        const strength = game.shakeMag * (game.shakeT / game.shakeDur);
        shakeX = rand(-strength, strength);
        shakeY = rand(-strength, strength);
    }
    if (world.chaseWall) {
        shakeX += rand(-2.2, 2.2);
        shakeY += rand(-2.2, 2.2);
    }
    ctx.translate(shakeX, shakeY);

    drawBackground();
    drawSigns();
    drawSpikes();
    drawSolids();
    drawFakeDoors();
    drawCrushers();
    drawProjectiles();
    drawChaseWall();

    if (world.dark) {
        drawDarkness();
        drawDarkGlows();
    }

    drawWorld2Hazards();
    drawDoor();
    drawPlayer();
    drawParticles();
    drawCountdown();

    ctx.restore();

    if (game.flash > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = 'rgba(229, 72, 77, ' + (game.flash * 0.32).toFixed(3) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
}

function drawBackground() {
    const worldIndex = game.worldIndex || 0;
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME_H);
    gradient.addColorStop(0, worldIndex === 0 ? '#15151d' : '#24151c');
    gradient.addColorStop(0.68, worldIndex === 0 ? '#101016' : '#170e13');
    gradient.addColorStop(1, worldIndex === 0 ? '#0b0b0f' : '#0d0709');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.032)';
    for (let x = 40; x < GAME_W; x += 64) {
        for (let y = 40; y < GAME_H; y += 64) {
            ctx.fillRect(x, y, 2, 2);
        }
    }

    const glow = ctx.createRadialGradient(GAME_W / 2, GAME_H * 0.72, 80, GAME_W / 2, GAME_H * 0.72, 820);
    glow.addColorStop(0, worldIndex === 0 ? 'rgba(229, 72, 77, 0.028)' : 'rgba(242, 140, 60, 0.045)');
    glow.addColorStop(1, 'rgba(229, 72, 77, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    if (worldIndex > 0) {
        const lava = ctx.createLinearGradient(0, GAME_H - 180, 0, GAME_H);
        lava.addColorStop(0, 'rgba(255, 90, 30, 0)');
        lava.addColorStop(0.62, 'rgba(255, 90, 30, 0.08)');
        lava.addColorStop(1, 'rgba(255, 140, 40, 0.24)');
        ctx.fillStyle = lava;
        ctx.fillRect(0, GAME_H - 180, GAME_W, 180);

        const time = performance.now() / 1000;
        for (let i = 0; i < 55; i++) {
            const x = (i * 173 + time * (10 + (i % 5) * 4)) % GAME_W;
            const y = GAME_H - ((i * 97 + time * (26 + (i % 7) * 5)) % GAME_H);
            const alpha = 0.12 + (i % 5) * 0.035;
            const size = 1.5 + (i % 3);
            ctx.fillStyle = 'rgba(255, ' + (110 + (i % 4) * 25) + ', 40, ' + alpha.toFixed(3) + ')';
            ctx.fillRect(x, y, size, size);
        }
    }
}

function drawSigns() {
    const inferno = (game.worldIndex || 0) > 0;
    ctx.save();
    ctx.font = '700 18px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const sign of world.signs) {
        const width = ctx.measureText(sign.text).width + 34;
        const height = 40;
        const x = sign.x - width / 2;
        const y = sign.y - height / 2;

        ctx.fillStyle = inferno ? 'rgba(28, 10, 9, 0.92)' : 'rgba(8, 8, 11, 0.86)';
        roundRect(x, y, width, height, 4);
        ctx.fill();

        ctx.strokeStyle = inferno ? 'rgba(255, 165, 82, 0.32)' : 'rgba(242, 240, 234, 0.22)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = inferno ? 'rgba(255, 217, 168, 0.92)' : 'rgba(242, 240, 234, 0.82)';
        ctx.fillText(sign.text, sign.x, sign.y + 1);

        ctx.fillStyle = inferno ? 'rgba(255, 138, 60, 0.95)' : 'rgba(229, 72, 77, 0.9)';
        ctx.beginPath();
        ctx.arc(x + 9, sign.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawSolids() {
    for (const solid of world.solids) {
        if (!solid.active) continue;

        const jitterX = solid.state === 'shake' ? Math.sin(performance.now() / 22 + solid.x) * 2.2 : 0;
        const jitterY = solid.state === 'shake' ? Math.cos(performance.now() / 19 + solid.x) * 1.8 : 0;
        const x = solid.x + jitterX;
        const y = solid.y + jitterY;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
        roundRect(x + 5, y + 9, solid.w, solid.h, 5);
        ctx.fill();

        const gradient = ctx.createLinearGradient(0, y, 0, y + Math.min(solid.h, 180));
        const inferno = (game.worldIndex || 0) > 0;

        if (inferno) {
            gradient.addColorStop(0, '#5a403d');
            gradient.addColorStop(0.14, '#43302f');
            gradient.addColorStop(1, '#211819');
        } else {
            gradient.addColorStop(0, '#f3f1e9');
            gradient.addColorStop(0.12, '#e9e6dc');
            gradient.addColorStop(1, '#c7c3b7');
        }

        ctx.fillStyle = gradient;
        roundRect(x, y, solid.w, solid.h, 5);
        ctx.fill();

        ctx.strokeStyle = inferno ? '#090506' : '#0c0c10';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = inferno ? 'rgba(255, 165, 82, 0.7)' : 'rgba(255, 255, 255, 0.62)';
        ctx.fillRect(x + 7, y + 5, Math.max(0, solid.w - 14), 3);

        if (solid.state === 'shake') {
            ctx.strokeStyle = 'rgba(12, 12, 16, 0.32)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x + solid.w * 0.3, y + 8);
            ctx.lineTo(x + solid.w * 0.36, y + solid.h * 0.42);
            ctx.lineTo(x + solid.w * 0.3, y + solid.h * 0.72);
            ctx.lineTo(x + solid.w * 0.38, y + solid.h - 8);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(x + solid.w * 0.68, y + 12);
            ctx.lineTo(x + solid.w * 0.62, y + solid.h * 0.5);
            ctx.lineTo(x + solid.w * 0.7, y + solid.h * 0.76);
            ctx.stroke();
        }
    }
}

function drawSpikes() {
    for (const spike of world.spikes) {
        if (!spike.active) continue;

        if (spike.warning) {
            ctx.save();
            ctx.globalAlpha = 0.45 + Math.sin(performance.now() / 55) * 0.3;
            ctx.fillStyle = '#e5484d';
            ctx.fillRect(spike.x, FLOOR_Y - 7, spike.w, 5);
            ctx.restore();
        }

        ctx.save();

        if (spike.dir === 'down') {
            ctx.beginPath();
            ctx.rect(0, spike.y, GAME_W, GAME_H - spike.y);
            ctx.clip();
        } else if (spike.dir === 'up') {
            ctx.beginPath();
            ctx.rect(0, 0, GAME_W, spike.y + spike.h);
            ctx.clip();
        }

        const offsetX = spike.dir === 'left' || spike.dir === 'right' ? spike.offset : 0;
        const offsetY = spike.dir === 'up' || spike.dir === 'down' ? spike.offset : 0;
        ctx.translate(offsetX, offsetY);

        drawSpikePath(spike);

        ctx.restore();
    }
}

function drawSpikePath(spike) {
    const { x, y, w, h, dir } = spike;
    const teethHeight = Math.min(38, h);
    const teethCount = Math.max(1, Math.round(w / 34));
    const toothWidth = w / teethCount;

    ctx.beginPath();

    if (dir === 'up') {
        ctx.moveTo(x, y + h);
        ctx.lineTo(x, y + teethHeight);
        for (let i = 0; i < teethCount; i++) {
            ctx.lineTo(x + i * toothWidth + toothWidth / 2, y);
            ctx.lineTo(x + (i + 1) * toothWidth, y + teethHeight);
        }
        ctx.lineTo(x + w, y + h);
    } else if (dir === 'down') {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.lineTo(x + w, y + h - teethHeight);
        for (let i = teethCount - 1; i >= 0; i--) {
            ctx.lineTo(x + i * toothWidth + toothWidth / 2, y + h);
            ctx.lineTo(x + i * toothWidth, y + h - teethHeight);
        }
    } else {
        ctx.rect(x, y, w, h);
    }

    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    if ((game.worldIndex || 0) > 0) {
        gradient.addColorStop(0, '#ffd166');
        gradient.addColorStop(1, '#d43a2a');
    } else {
        gradient.addColorStop(0, '#ff6b6e');
        gradient.addColorStop(1, '#b52f35');
    }
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = '#0c0c10';
    ctx.lineWidth = 4;
    ctx.stroke();
}

function drawFakeDoors() {
    for (const door of world.fakeDoors) {
        if (!door.active) continue;
        drawDoorObject(door, false);
    }
}

function drawDoor() {
    const door = world.door;
    if (!door || door.hidden) return;
    drawDoorObject(door, door.locked);
}

function drawDoorObject(door, locked) {
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    const rgb = locked ? '229,72,77' : '242,193,78';

    const aura = ctx.createRadialGradient(cx, cy, 10, cx, cy, 130);
    aura.addColorStop(0, 'rgba(' + rgb + ', 0.2)');
    aura.addColorStop(1, 'rgba(' + rgb + ', 0)');
    ctx.fillStyle = aura;
    ctx.fillRect(cx - 140, cy - 140, 280, 280);

    ctx.fillStyle = '#0b0b0e';
    roundRect(door.x - 8, door.y - 8, door.w + 16, door.h + 16, 7);
    ctx.fill();

    ctx.strokeStyle = 'rgba(242, 240, 234, 0.82)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = locked ? '#3b262a' : '#f2f0ea';
    roundRect(door.x, door.y, door.w, door.h, 4);
    ctx.fill();

    ctx.strokeStyle = locked ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.13)';
    ctx.lineWidth = 2;
    ctx.strokeRect(door.x + 10, door.y + 12, door.w - 20, door.h - 24);

    ctx.fillStyle = '#0b0b0e';
    ctx.beginPath();
    ctx.arc(door.x + door.w - 16, door.y + door.h * 0.58, 4, 0, Math.PI * 2);
    ctx.fill();

    if (locked) {
        ctx.strokeStyle = '#e5484d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, door.y + 42, 10, Math.PI, 0);
        ctx.stroke();
        ctx.fillStyle = '#e5484d';
        roundRect(cx - 13, door.y + 42, 26, 20, 3);
        ctx.fill();
        ctx.fillStyle = '#1a0d10';
        ctx.beginPath();
        ctx.arc(cx, door.y + 51, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCrushers() {
    for (const crusher of world.crushers) {
        const warning = crusher.state === 'warn';

        if (warning) {
            ctx.save();
            ctx.globalAlpha = 0.25 + Math.sin(performance.now() / 55) * 0.25;
            ctx.fillStyle = '#e5484d';
            ctx.fillRect(crusher.x, FLOOR_Y - 6, crusher.w, 6);
            ctx.restore();
        }

        let y = crusher.y;
        if (warning) y += Math.sin(performance.now() / 24) * 2.5;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        roundRect(crusher.x + 6, y + 12, crusher.w, crusher.h, 8);
        ctx.fill();

        const gradient = ctx.createLinearGradient(0, y, 0, y + crusher.h);
        gradient.addColorStop(0, '#3b3b48');
        gradient.addColorStop(1, '#202028');
        ctx.fillStyle = gradient;
        roundRect(crusher.x, y, crusher.w, crusher.h, 8);
        ctx.fill();

        ctx.strokeStyle = '#08080b';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = 'rgba(242, 240, 234, 0.12)';
        ctx.fillRect(crusher.x + 8, y + 5, crusher.w - 16, 2);

        ctx.fillStyle = 'rgba(229, 72, 77, 0.28)';
        ctx.fillRect(crusher.x + 10, y + 12, crusher.w - 20, 4);

        ctx.fillStyle = '#e5484d';
        const teeth = 5;
        const toothWidth = crusher.w / teeth;
        for (let i = 0; i < teeth; i++) {
            ctx.beginPath();
            ctx.moveTo(crusher.x + i * toothWidth, crusher.y + crusher.h - 1);
            ctx.lineTo(crusher.x + i * toothWidth + toothWidth / 2, crusher.y + crusher.h + 20);
            ctx.lineTo(crusher.x + (i + 1) * toothWidth, crusher.y + crusher.h - 1);
            ctx.closePath();
            ctx.fill();
        }
    }
}

function drawProjectiles() {
    for (const proj of world.projectiles) {
        if (proj.warn > 0) {
            const pulse = 0.45 + Math.sin(performance.now() / 55) * 0.28;
            ctx.save();
            ctx.strokeStyle = 'rgba(229, 72, 77, ' + pulse.toFixed(2) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(proj.x, FLOOR_Y - 4, 25, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = 'rgba(229, 72, 77, 0.9)';
            ctx.beginPath();
            ctx.moveTo(proj.x, 18);
            ctx.lineTo(proj.x - 9, 38);
            ctx.lineTo(proj.x + 9, 38);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            continue;
        }

        const cx = proj.x;
        const cy = proj.y + 21;
        const radius = 18;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(proj.spin);

        ctx.fillStyle = '#e5484d';
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle - 0.2) * radius, Math.sin(angle - 0.2) * radius);
            ctx.lineTo(Math.cos(angle) * (radius + 11), Math.sin(angle) * (radius + 11));
            ctx.lineTo(Math.cos(angle + 0.2) * radius, Math.sin(angle + 0.2) * radius);
            ctx.closePath();
            ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#c0353a';
        ctx.fill();
        ctx.strokeStyle = '#0c0c10';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(-5, -5, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

function drawWorld2Hazards() {
    if (!world.world2) return;

    const now = performance.now();

    for (const jet of world.fireJets) {
        const baseY = FLOOR_Y;
        const x = jet.x;

        ctx.fillStyle = '#241315';
        ctx.fillRect(x - 38, baseY - 10, 76, 10);
        ctx.fillStyle = '#ff8a3c';
        ctx.fillRect(x - 30, baseY - 8, 60, 4);

        if (jet.state === 'warn') {
            ctx.save();
            ctx.globalAlpha = 0.45 + Math.sin(now / 55) * 0.3;
            ctx.fillStyle = '#ffb36b';
            ctx.beginPath();
            ctx.arc(x, baseY - 8, 24, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        if (jet.state === 'on') {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const flames = 5;
            const flameWidth = jet.width / flames;

            for (let i = 0; i < flames; i++) {
                const left = x - jet.width / 2 + i * flameWidth;
                const flicker = Math.sin(now / 60 + i * 1.7 + jet.phase) * 9;
                const tipX = left + flameWidth / 2 + flicker;
                const tipY = baseY - jet.height * (0.72 + Math.sin(now / 95 + i) * 0.16);

                const gradient = ctx.createLinearGradient(0, baseY - jet.height, 0, baseY);
                gradient.addColorStop(0, 'rgba(255, 230, 120, 0.05)');
                gradient.addColorStop(0.45, 'rgba(255, 145, 40, 0.55)');
                gradient.addColorStop(1, 'rgba(255, 80, 20, 0.75)');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.moveTo(left, baseY);
                ctx.quadraticCurveTo(left + flameWidth * 0.12, baseY - jet.height * 0.52, tipX, tipY);
                ctx.quadraticCurveTo(left + flameWidth * 0.9, baseY - jet.height * 0.4, left + flameWidth, baseY);
                ctx.closePath();
                ctx.fill();
            }

            ctx.fillStyle = 'rgba(255, 232, 144, 0.85)';
            ctx.beginPath();
            ctx.ellipse(x, baseY - 10, 18, 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    for (const laser of world.lasers) {
        const x = laser.x;
        const top = laser.top;
        const height = FLOOR_Y - top;

        ctx.fillStyle = '#241517';
        ctx.fillRect(x - 16, top - 22, 32, 16);
        ctx.fillStyle = laser.state === 'on' ? '#ff5252' : '#5e2c2c';
        ctx.fillRect(x - 9, top - 20, 18, 7);

        if (laser.state === 'warn') {
            ctx.save();
            ctx.globalAlpha = 0.35 + Math.sin(now / 55) * 0.2;
            ctx.strokeStyle = '#ff5252';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 10]);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, FLOOR_Y);
            ctx.stroke();
            ctx.restore();
        }

        if (laser.state === 'on') {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const gradient = ctx.createLinearGradient(0, top, 0, FLOOR_Y);
            gradient.addColorStop(0, 'rgba(255, 80, 80, 0.15)');
            gradient.addColorStop(0.5, 'rgba(255, 90, 90, 0.7)');
            gradient.addColorStop(1, 'rgba(255, 60, 60, 0.25)');

            ctx.fillStyle = gradient;
            ctx.fillRect(x - 14, top, 28, height);

            ctx.fillStyle = 'rgba(255, 245, 220, 0.95)';
            ctx.fillRect(x - 2, top, 4, height);
            ctx.restore();
        }

        ctx.fillStyle = '#241517';
        ctx.fillRect(x - 16, FLOOR_Y - 12, 32, 12);
        ctx.fillStyle = laser.state === 'on' ? '#ff5252' : '#5e2c2c';
        ctx.fillRect(x - 8, FLOOR_Y - 11, 16, 5);
    }

    for (const saw of world.saws) {
        ctx.save();
        ctx.translate(saw.x, saw.y);
        ctx.rotate(saw.angle);

        ctx.fillStyle = 'rgba(255, 120, 50, 0.16)';
        ctx.beginPath();
        ctx.arc(0, 0, saw.radius + 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#c9c2b7';
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle - 0.16) * saw.radius, Math.sin(angle - 0.16) * saw.radius);
            ctx.lineTo(Math.cos(angle) * (saw.radius + 10), Math.sin(angle) * (saw.radius + 10));
            ctx.lineTo(Math.cos(angle + 0.16) * saw.radius, Math.sin(angle + 0.16) * saw.radius);
            ctx.closePath();
            ctx.fill();
        }

        ctx.fillStyle = '#8a8076';
        ctx.beginPath();
        ctx.arc(0, 0, saw.radius - 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#2a2424';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, saw.radius - 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#2a2424';
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    for (const rock of world.rocks) {
        if (rock.warn > 0) {
            ctx.save();
            ctx.globalAlpha = 0.45 + Math.sin(now / 55) * 0.25;
            ctx.fillStyle = '#ff7043';
            ctx.beginPath();
            ctx.moveTo(rock.x, 76);
            ctx.lineTo(rock.x - 11, 98);
            ctx.lineTo(rock.x + 11, 98);
            ctx.closePath();
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 112, 67, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(rock.x, FLOOR_Y - 4, 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            continue;
        }

        ctx.save();
        ctx.translate(rock.x, rock.y + rock.h / 2);
        ctx.rotate(rock.spin);

        ctx.fillStyle = '#7c5a46';
        ctx.beginPath();
        ctx.moveTo(-18, -6);
        ctx.lineTo(-8, -18);
        ctx.lineTo(10, -16);
        ctx.lineTo(18, -2);
        ctx.lineTo(13, 14);
        ctx.lineTo(-4, 18);
        ctx.lineTo(-17, 9);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#2a1a13';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 140, 70, 0.55)';
        ctx.fillRect(-6, -3, 12, 4);

        ctx.restore();
    }
}

function drawChaseWall() {
    const wall = world.chaseWall;
    if (!wall) return;

    const x = wall.x;

    ctx.save();
    ctx.fillStyle = '#241115';
    ctx.fillRect(x, 0, 190, GAME_H);

    ctx.strokeStyle = '#e5484d';
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, 2, 186, GAME_H - 4);

    ctx.fillStyle = '#e5484d';
    for (let y = 0; y < GAME_H; y += 62) {
        ctx.beginPath();
        ctx.moveTo(x + 188, y);
        ctx.lineTo(x + 234, y + 31);
        ctx.lineTo(x + 188, y + 62);
        ctx.closePath();
        ctx.fill();
    }

    ctx.fillStyle = 'rgba(229, 72, 77, 0.14)';
    for (let y = 18; y < GAME_H; y += 46) {
        ctx.fillRect(x + 18, y, 120, 5);
    }

    ctx.fillStyle = 'rgba(242, 240, 234, 0.55)';
    ctx.font = '800 11px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(x + 95, GAME_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('CORRE', 0, 0);
    ctx.restore();

    ctx.restore();
}

function drawDarkness() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 70, cx, cy, 330);
    gradient.addColorStop(0, 'rgba(4, 4, 7, 0)');
    gradient.addColorStop(0.68, 'rgba(4, 4, 7, 0.84)');
    gradient.addColorStop(1, 'rgba(4, 4, 7, 0.97)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
}

function drawDarkGlows() {
    const cx = player.x + player.w / 2;
    const cy = player.y + player.h / 2;

    for (const spike of world.spikes) {
        if (!spike.active) continue;
        if (Math.abs(spike.offset) > spike.h * 0.35) continue;

        const sx = spike.x + spike.w / 2;
        const sy = spike.y + spike.offset + spike.h / 2;
        const dist = Math.hypot(sx - cx, sy - cy);
        if (dist > 380) continue;

        const alpha = (1 - dist / 380) * 0.3;
        const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, 90);
        glow.addColorStop(0, 'rgba(229, 72, 77, ' + alpha.toFixed(3) + ')');
        glow.addColorStop(1, 'rgba(229, 72, 77, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(sx - 90, sy - 90, 180, 180);
    }
}

function drawPlayer() {
    if (player.dead || game.phase === 'dying') return;

    const p = player;
    const cx = p.x + p.w / 2;
    const bottom = p.y + p.h;
    const bob = p.onGround && Math.abs(p.vx) > 24 ? Math.sin(p.runCycle) * 1.5 : 0;

    const scaleX = 1 + p.squash * 0.55;
    const scaleY = 1 - p.squash;

    ctx.save();
    ctx.translate(cx, bottom);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-cx, -bottom);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    roundRect(p.x + 4, p.y + bob + 5, p.w, p.h, 10);
    ctx.fill();

    ctx.fillStyle = '#f4f2ec';
    roundRect(p.x, p.y + bob, p.w, p.h, 10);
    ctx.fill();

    ctx.strokeStyle = '#0b0b0e';
    ctx.lineWidth = 4;
    ctx.stroke();

    drawHorn(p.x + 11, p.y + bob + 2, -0.2);
    drawHorn(p.x + p.w - 11, p.y + bob + 2, 0.2);

    const eyeShift = p.facing * 4;
    const eyeY = p.y + bob + 17;
    const blink = performance.now() % 3600 < 110;

    ctx.fillStyle = '#0b0b0e';
    if (blink) {
        roundRect(cx - 13 + eyeShift, eyeY + 4, 8, 3, 1.5);
        ctx.fill();
        roundRect(cx + 5 + eyeShift, eyeY + 4, 8, 3, 1.5);
        ctx.fill();
    } else {
        roundRect(cx - 13 + eyeShift, eyeY, 8, 12, 3);
        ctx.fill();
        roundRect(cx + 5 + eyeShift, eyeY, 8, 12, 3);
        ctx.fill();
    }

    ctx.strokeStyle = 'rgba(11, 11, 14, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 5, p.y + bob + 34);
    ctx.lineTo(cx + 5, p.y + bob + 34);
    ctx.stroke();

    ctx.restore();
}

function drawHorn(x, y, tilt) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(0, -10);
    ctx.lineTo(5, 0);
    ctx.closePath();
    ctx.fillStyle = '#e5484d';
    ctx.fill();
    ctx.strokeStyle = '#0b0b0e';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawParticles() {
    for (const p of particles) {
        const alpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        const size = p.size * (0.4 + alpha * 0.6);
        ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
}

function drawCountdown() {
    if (!world.countdown || world.countdown <= 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(229, 72, 77, 0.88)';
    ctx.font = '800 12px Orbitron, sans-serif';
    ctx.fillText('SOBREVIVA', GAME_W / 2, 128);
    ctx.fillStyle = '#f2f0ea';
    ctx.font = '900 46px Orbitron, sans-serif';
    ctx.fillText(world.countdown.toFixed(1), GAME_W / 2, 178);
    ctx.restore();
}

/* ------------------------------------------------------------------
   Entrada
------------------------------------------------------------------ */

function clearInput() {
    input.left = false;
    input.right = false;
    input.jump = false;
}

function canControl() {
    return game.screen === 'game' && !game.paused && game.phase === 'play';
}

function handleKeyDown(event) {
    const code = event.code;
    const blocked = [
        'Space',
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown'
    ];

    if (blocked.includes(code)) event.preventDefault();

    if (!$('tutorial-modal').classList.contains('hidden')) {
        if (code === 'Escape') closeTutorial();
        return;
    }

    if (code === 'KeyM') {
        toggleSound();
        return;
    }

    if (game.screen === 'intro') {
        if (code === 'Enter' || code === 'Space') {
            event.preventDefault();
            enterMenu();
        }
        return;
    }

    if (game.screen === 'game' && game.phase === 'world') {
        return;
    }

    if (game.screen === 'game' && game.phase === 'chapter') {
        if (code === 'Enter' || code === 'Space') {
            event.preventDefault();
            enterPortal();
        }
        return;
    }

    if (code === 'Escape') {
        if (game.screen === 'game' && !game.paused && game.phase === 'play') {
            pauseGame();
        } else if (game.paused) {
            resumeGame();
        }
        return;
    }

    if (!canControl()) return;

    if (code === 'KeyR') {
        restartLevel();
        return;
    }

    if (code === 'KeyA' || code === 'ArrowLeft') input.left = true;
    if (code === 'KeyD' || code === 'ArrowRight') input.right = true;

    if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') {
        input.jump = true;
        if (!event.repeat) player.jumpBuffer = JUMP_BUFFER_TIME;
    }
}

function handleKeyUp(event) {
    const code = event.code;
    if (code === 'KeyA' || code === 'ArrowLeft') input.left = false;
    if (code === 'KeyD' || code === 'ArrowRight') input.right = false;
    if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') input.jump = false;
}

function bindTouchControls() {
    const buttons = document.querySelectorAll('[data-touch]');

    buttons.forEach((button) => {
        const key = button.getAttribute('data-touch');

        const press = (event) => {
            event.preventDefault();
            button.classList.add('active');

            if (!canControl()) return;

            if (key === 'jump') {
                input.jump = true;
                player.jumpBuffer = JUMP_BUFFER_TIME;
            } else {
                input[key] = true;
            }
        };

        const release = (event) => {
            if (event) event.preventDefault();
            button.classList.remove('active');

            if (key === 'jump') input.jump = false;
            else input[key] = false;
        };

        button.addEventListener('pointerdown', press);
        button.addEventListener('pointerup', release);
        button.addEventListener('pointercancel', release);
        button.addEventListener('pointerleave', release);
    });
}

/* ------------------------------------------------------------------
   Ligações de UI
------------------------------------------------------------------ */

function bindUI() {
    $('btn-intro-enter')?.addEventListener('click', enterMenu);
    $('intro-splash')?.addEventListener('click', enterMenu);

    $('btn-menu-start')?.addEventListener('click', startGame);
    $('btn-menu-tutorial')?.addEventListener('click', openTutorial);
    $('btn-menu-back')?.addEventListener('click', showIntro);
    $('btn-portal')?.addEventListener('click', enterPortal);

    $('map-close')?.addEventListener('click', goMenu);
    $('map-help')?.addEventListener('click', openTutorial);
    $('map-sound')?.addEventListener('click', toggleSound);
    $('map-portal')?.addEventListener('click', handleMapPortal);

    $('btn-close-tutorial')?.addEventListener('click', closeTutorial);

    $('btn-pause')?.addEventListener('click', pauseGame);
    $('btn-resume')?.addEventListener('click', resumeGame);
    $('btn-restart-level')?.addEventListener('click', restartLevel);
    $('btn-pause-tutorial')?.addEventListener('click', openTutorial);
    $('btn-menu')?.addEventListener('click', goMenu);

    $('btn-restart-game')?.addEventListener('click', startGame);
    $('btn-victory-menu')?.addEventListener('click', goMenu);

    $('btn-sound')?.addEventListener('click', toggleSound);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    window.addEventListener('blur', () => {
        clearInput();
        if (game.screen === 'game' && game.phase === 'play' && !game.paused) pauseGame();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInput();
            if (game.screen === 'game' && game.phase === 'play' && !game.paused) pauseGame();
        }
    });

    bindTouchControls();
}

/* ------------------------------------------------------------------
   Loop principal
------------------------------------------------------------------ */

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
    requestAnimationFrame(frame);

    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (game.screen === 'game' && !game.paused && game.phase !== 'victory' && game.phase !== 'idle') {
        accumulator += delta;
        let steps = 0;
        while (accumulator >= STEP && steps < 12) {
            update(STEP);
            accumulator -= STEP;
            steps += 1;
        }
        if (steps === 12) accumulator = 0;
    } else {
        accumulator = 0;
    }

    render();
    updateHudClock();
}

/* ------------------------------------------------------------------
   Inicialização
------------------------------------------------------------------ */

function init() {
    resizeCanvas();
    bindUI();
    updateSoundButton();
    document.body.classList.toggle('touch-device', IS_TOUCH);

    const totalPhases = LEVELS.length * TOTAL_WORLDS;
    const menuLevels = $('menu-levels');
    if (menuLevels) menuLevels.textContent = totalPhases;
    const victoryLevels = $('vic-levels');
    if (victoryLevels) victoryLevels.textContent = totalPhases;

    showIntro();

    // Ajuda de desenvolvimento: permite pular direto para uma fase no console.
    window.__parkour = {
        game,
        player,
        loadLevel,
        startGame,
        openMenu,
        showIntro,
        enterMenu,
        beginWorld,
        getWorld: () => world
    };

    requestAnimationFrame(frame);
}

init();
