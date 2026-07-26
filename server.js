const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const activeGames = {}; 

// --- SEQUENCE GENERATORS ---
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Q', 'K', 'A'];
const JACKS = ['♠-J', '♥-J', '♣-J', '♦-J'];
const STANDARD_BOARD_LAYOUT = [
    'FREE', '♠-2', '♠-3', '♠-4', '♠-5', '♠-6', '♠-7', '♠-8', '♠-9', 'FREE',
    '♣-6', '♣-5', '♣-4', '♣-3', '♣-2', '♥-A', '♥-K', '♥-Q', '♥-10', '♠-10',
    '♣-7', '♠-A', '♦-2', '♦-3', '♦-4', '♦-5', '♦-6', '♦-7', '♥-9', '♠-Q',
    '♣-8', '♠-K', '♣-6', '♣-5', '♣-4', '♣-3', '♣-2', '♦-8', '♥-8', '♠-K',
    '♣-9', '♠-Q', '♣-7', '♥-6', '♥-5', '♥-4', '♥-A', '♦-9', '♥-7', '♠-A',
    '♣-10', '♠-10', '♣-8', '♥-7', '♥-2', '♥-3', '♥-K', '♦-10', '♥-6', '♦-2',
    '♣-Q', '♠-9', '♣-9', '♥-8', '♥-9', '♥-10', '♥-Q', '♦-Q', '♥-5', '♦-3',
    '♣-K', '♠-8', '♣-10', '♣-Q', '♣-K', '♣-A', '♦-A', '♦-K', '♥-4', '♦-4',
    '♣-A', '♠-7', '♠-6', '♠-5', '♠-4', '♠-3', '♠-2', '♥-2', '♥-3', '♦-5',
    'FREE', '♦-A', '♦-K', '♦-Q', '♦-10', '♦-9', '♦-8', '♦-7', '♦-6', 'FREE'
];

function generateSeqBoard() { return STANDARD_BOARD_LAYOUT.map(card => ({ card, team: null, locked: false })); }
function generateSeqDeck() {
    let deck = [];
    for (let i = 0; i < 2; i++) { 
        SUITS.forEach(s => RANKS.forEach(r => deck.push(`${s}-${r}`)));
        JACKS.forEach(j => deck.push(j));
    }
    return deck.sort(() => Math.random() - 0.5); 
}
function countSequences(boardState, team) {
    let count = 0; const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]; 
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            for (let [dr, dc] of dirs) {
                let isSeq = true; let seqInd = [];
                for (let i = 0; i < 5; i++) {
                    let nr = r + dr * i, nc = c + dc * i;
                    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) { isSeq = false; break; }
                    let idx = nr * 10 + nc; if (boardState[idx].team !== team && boardState[idx].card !== 'FREE') { isSeq = false; break; }
                    seqInd.push(idx);
                }
                if (isSeq) {
                    let pr = r - dr, pc = c - dc;
                    if (pr >= 0 && pr < 10 && pc >= 0 && pc < 10) {
                        let prev = boardState[pr * 10 + pc]; if (prev.team === team || prev.card === 'FREE') continue; 
                    }
                    count++; seqInd.forEach(idx => { if (boardState[idx].card !== 'FREE') boardState[idx].locked = true; });
                }
            }
        }
    }
    return count;
}

// --- UNO GENERATORS ---
function generateUnoDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0','1','1','2','2','3','3','4','4','5','5','6','6','7','7','8','8','9','9','Skip','Skip','Rev','Rev','+2','+2'];
    let deck = [];
    colors.forEach(color => { values.forEach(val => deck.push({ color, value: val })); });
    for(let i=0; i<4; i++) { deck.push({ color: 'black', value: 'Wild' }); deck.push({ color: 'black', value: '+4' }); }
    return deck.sort(() => Math.random() - 0.5);
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    socket.on('joinRoom', ({ roomId, nickname, gameType }) => {
        socket.join(roomId);
        if (!activeGames[roomId]) {
            activeGames[roomId] = {
                gameType: gameType || 'sequence', host: socket.id, players: {}, turnOrder: [], currentTurnIndex: 0, currentTurnPlayer: null, isLive: false, gameOver: false
            };
        }
        const game = activeGames[roomId];
        game.gameType = gameType; // Ensure type updates if host switches on landing page
        if (game.players[nickname]) game.players[nickname].socketId = socket.id;
        else game.players[nickname] = { socketId: socket.id, team: 'blue', hand: [] };
        
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(n => ({ name: n, team: game.players[n].team, isHost: game.host === game.players[n].socketId })));
        if (game.isLive) emitGameState(roomId);
    });

    socket.on('updateTeams', ({ roomId, updatedPlayers }) => {
        const game = activeGames[roomId]; if (!game) return;
        updatedPlayers.forEach(p => { if (game.players[p.name]) game.players[p.name].team = p.team; });
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(n => ({ name: n, team: game.players[n].team, isHost: game.host === game.players[n].socketId })));
    });

    socket.on('startGame', ({ roomId }) => {
        const game = activeGames[roomId]; if (!game || game.isLive) return;
        
        // Build Turn Order
        game.turnOrder = [];
        if (game.gameType === 'sequence') {
            let pts = {}; Object.keys(game.players).forEach(u => { let t = game.players[u].team; if(!pts[t]) pts[t]=[]; pts[t].push(u); });
            let max = Math.max(...Object.keys(pts).map(t => pts[t].length), 0);
            for (let i=0; i<max; i++) Object.keys(pts).forEach(t => { if(pts[t][i]) game.turnOrder.push(pts[t][i]); });
        } else {
            game.turnOrder = Object.keys(game.players); // Uno ignores teams
        }
        
        if (game.turnOrder.length === 0) return; 
        game.currentTurnIndex = 0; game.currentTurnPlayer = game.turnOrder[0]; game.isLive = true; game.gameOver = false;

        // Init Specific Game State
        if (game.gameType === 'sequence') {
            game.boardState = generateSeqBoard(); game.deck = generateSeqDeck(); game.discardPile = [];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.deck.pop()); });
        } else if (game.gameType === 'uno') {
            game.unoDeck = generateUnoDeck(); game.direction = 1;
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.unoDeck.pop()); });
            let top = game.unoDeck.pop(); while(top.color === 'black') { game.unoDeck.unshift(top); top = game.unoDeck.pop(); }
            game.topCard = top;
        }
        emitGameState(roomId);
    });

    // --- SEQUENCE MOVES ---
    socket.on('playMove', ({ roomId, username, boardIndex, cardPlayed }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'sequence' || game.currentTurnPlayer !== username) return;
        const player = game.players[username];
        const space = game.boardState[boardIndex];
        const isTwoEyed = cardPlayed === '♣-J' || cardPlayed === '♦-J'; const isOneEyed = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        if ((space.card === cardPlayed || isTwoEyed) && !space.team && space.card !== 'FREE') game.boardState[boardIndex].team = player.team;
        else if (isOneEyed && space.team && space.team !== player.team && space.card !== 'FREE') {
            if (space.locked) return; game.boardState[boardIndex].team = null;
        } else return; 

        const cIdx = player.hand.indexOf(cardPlayed); if (cIdx !== -1) player.hand.splice(cIdx, 1);
        game.discardPile.push(cardPlayed); if (game.discardPile.length > 3) game.discardPile.shift();
        if (game.deck.length > 0) player.hand.push(game.deck.pop());

        game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        
        let sRed = countSequences(game.boardState, 'red'), sBlue = countSequences(game.boardState, 'blue'), sGreen = countSequences(game.boardState, 'green');
        if (sRed >= 2) { game.gameOver = true; io.to(roomId).emit('gameOver', 'Red Team Wins'); }
        if (sBlue >= 2) { game.gameOver = true; io.to(roomId).emit('gameOver', 'Blue Team Wins'); }
        if (sGreen >= 2) { game.gameOver = true; io.to(roomId).emit('gameOver', 'Green Team Wins'); }
        emitGameState(roomId);
    });

    // --- UNO MOVES ---
    socket.on('playUnoMove', ({ roomId, username, card, chosenColor }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'uno' || game.currentTurnPlayer !== username) return;
        
        // Validate
        const isMatch = card.color === 'black' || card.color === game.topCard.color || card.value === game.topCard.value;
        if (!isMatch) return;

        // Apply Card
        const p = game.players[username];
        const cIdx = p.hand.findIndex(c => c.color === card.color && c.value === card.value);
        if (cIdx !== -1) p.hand.splice(cIdx, 1);

        game.topCard = { color: card.color === 'black' ? chosenColor : card.color, value: card.value };

        if (p.hand.length === 0) {
            game.gameOver = true; io.to(roomId).emit('gameOver', `${username} Wins!`); emitGameState(roomId); return;
        }

        let steps = 1;
        if (card.value === 'Rev') { game.direction *= -1; if(game.turnOrder.length === 2) steps = 2; } // Reverse is skip in 2 player
        else if (card.value === 'Skip') steps = 2;
        else if (card.value === '+2') { steps = 2; forceDraw(game, 2); }
        else if (card.value === '+4') { steps = 2; forceDraw(game, 4); }

        advanceUnoTurn(game, steps);
        emitGameState(roomId);
    });

    socket.on('drawUnoCard', ({ roomId, username }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'uno' || game.currentTurnPlayer !== username) return;
        if(game.unoDeck.length === 0) game.unoDeck = generateUnoDeck(); // Fallback reshuffle
        game.players[username].hand.push(game.unoDeck.pop());
        advanceUnoTurn(game, 1);
        emitGameState(roomId);
    });

    function forceDraw(game, amount) {
        const nextIdx = (game.currentTurnIndex + game.direction + game.turnOrder.length) % game.turnOrder.length;
        const target = game.players[game.turnOrder[nextIdx]];
        for(let i=0; i<amount; i++) { if(game.unoDeck.length === 0) game.unoDeck = generateUnoDeck(); target.hand.push(game.unoDeck.pop()); }
    }

    function advanceUnoTurn(game, steps) {
        let dir = game.direction * steps;
        game.currentTurnIndex = (game.currentTurnIndex + dir + (game.turnOrder.length * 5)) % game.turnOrder.length;
        game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
    }

    // --- SHARED ROUTER ---
    socket.on('rematch', ({ roomId }) => {
        const game = activeGames[roomId]; if (!game || !game.gameOver) return;
        game.gameOver = false;
        
        if(game.gameType === 'sequence') {
            game.boardState = generateSeqBoard(); game.deck = generateSeqDeck(); game.discardPile = [];
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.deck.pop()); });
        } else {
            game.unoDeck = generateUnoDeck(); game.direction = 1;
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.unoDeck.pop()); });
            let top = game.unoDeck.pop(); while(top.color === 'black') { game.unoDeck.unshift(top); top = game.unoDeck.pop(); }
            game.topCard = top;
        }
        emitGameState(roomId);
    });

    function emitGameState(roomId) {
        const game = activeGames[roomId];
        Object.keys(game.players).forEach(name => {
            const p = game.players[name];
            let payload = { gameType: game.gameType, turnPlayer: game.currentTurnPlayer, isGameOver: game.gameOver };
            
            if (game.gameType === 'sequence') {
                payload = { ...payload, board: game.boardState, hand: p.hand, turnTeam: game.players[game.currentTurnPlayer].team, me: p, lastDiscards: game.discardPile, cardsLeft: game.deck.length, scores: { 'red': countSequences(game.boardState, 'red'), 'blue': countSequences(game.boardState, 'blue'), 'green': countSequences(game.boardState, 'green') }};
            } else {
                let pList = Object.keys(game.players).map(n => ({ name: n, cardCount: game.players[n].hand.length }));
                payload = { ...payload, hand: p.hand, topCard: game.topCard, playerList: pList };
            }
            io.to(p.socketId).emit('gameState', payload);
        });
    }
});

server.listen(3000, () => console.log('Multi-Game Server Hub Running!'));
