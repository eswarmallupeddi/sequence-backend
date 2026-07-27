const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const activeGames = {}; 

// --- SEQUENCE ENGINE ---
const SUITS = ['♠', '♥', '♣', '♦']; const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Q', 'K', 'A']; const JACKS = ['♠-J', '♥-J', '♣-J', '♦-J'];
const STANDARD_BOARD_LAYOUT = [ 'FREE', '♠-2', '♠-3', '♠-4', '♠-5', '♠-6', '♠-7', '♠-8', '♠-9', 'FREE', '♣-6', '♣-5', '♣-4', '♣-3', '♣-2', '♥-A', '♥-K', '♥-Q', '♥-10', '♠-10', '♣-7', '♠-A', '♦-2', '♦-3', '♦-4', '♦-5', '♦-6', '♦-7', '♥-9', '♠-Q', '♣-8', '♠-K', '♣-6', '♣-5', '♣-4', '♣-3', '♣-2', '♦-8', '♥-8', '♠-K', '♣-9', '♠-Q', '♣-7', '♥-6', '♥-5', '♥-4', '♥-A', '♦-9', '♥-7', '♠-A', '♣-10', '♠-10', '♣-8', '♥-7', '♥-2', '♥-3', '♥-K', '♦-10', '♥-6', '♦-2', '♣-Q', '♠-9', '♣-9', '♥-8', '♥-9', '♥-10', '♥-Q', '♦-Q', '♥-5', '♦-3', '♣-K', '♠-8', '♣-10', '♣-Q', '♣-K', '♣-A', '♦-A', '♦-K', '♥-4', '♦-4', '♣-A', '♠-7', '♠-6', '♠-5', '♠-4', '♠-3', '♠-2', '♥-2', '♥-3', '♦-5', 'FREE', '♦-A', '♦-K', '♦-Q', '♦-10', '♦-9', '♦-8', '♦-7', '♦-6', 'FREE' ];
function generateSeqBoard() { return STANDARD_BOARD_LAYOUT.map(card => ({ card, team: null, locked: false })); }
function generateSeqDeck() { let deck = []; for (let i = 0; i < 2; i++) { SUITS.forEach(s => RANKS.forEach(r => deck.push(`${s}-${r}`))); JACKS.forEach(j => deck.push(j)); } return deck.sort(() => Math.random() - 0.5); }
function countSequences(boardState, team) { let count = 0; const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]; for (let r = 0; r < 10; r++) { for (let c = 0; c < 10; c++) { for (let [dr, dc] of dirs) { let isSeq = true; let seqInd = []; for (let i = 0; i < 5; i++) { let nr = r + dr * i, nc = c + dc * i; if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) { isSeq = false; break; } let idx = nr * 10 + nc; if (boardState[idx].team !== team && boardState[idx].card !== 'FREE') { isSeq = false; break; } seqInd.push(idx); } if (isSeq) { let pr = r - dr, pc = c - dc; if (pr >= 0 && pr < 10 && pc >= 0 && pc < 10) { let prev = boardState[pr * 10 + pc]; if (prev.team === team || prev.card === 'FREE') continue; } count++; seqInd.forEach(idx => { if (boardState[idx].card !== 'FREE') boardState[idx].locked = true; }); } } } } return count; }

// --- COLOR MATCH ENGINE ---
function generateUnoDeck() { const colors = ['red', 'blue', 'green', 'yellow']; const values = ['0','1','1','2','2','3','3','4','4','5','5','6','6','7','7','8','8','9','9','Skip','Skip','Rev','Rev','+2','+2']; let deck = []; colors.forEach(color => { values.forEach(val => deck.push({ color, value: val })); }); for(let i=0; i<4; i++) { deck.push({ color: 'black', value: 'Wild' }); deck.push({ color: 'black', value: '+4' }); } return deck.sort(() => Math.random() - 0.5); }

// --- DAADI ENGINE ---
const DAADI_MILLS = [ [0,1,2],[2,3,4],[4,5,6],[6,7,0],[8,9,10],[10,11,12],[12,13,14],[14,15,8],[16,17,18],[18,19,20],[20,21,22],[22,23,16],[1,9,17],[3,11,19],[5,13,21],[7,15,23] ];
const DAADI_ADJ = { 0:[1,7], 1:[0,2,9], 2:[1,3], 3:[2,4,11], 4:[3,5], 5:[4,6,13], 6:[5,7], 7:[0,6,15], 8:[9,15], 9:[1,8,10,17], 10:[9,11], 11:[3,10,12,19], 12:[11,13], 13:[5,12,14,21], 14:[13,15], 15:[7,8,14,23], 16:[17,23], 17:[9,16,18], 18:[17,19], 19:[11,18,20], 20:[19,21], 21:[13,20,22], 22:[21,23], 23:[15,16,22] };
function checkDaadiMill(board, index, icon) { for (let mill of DAADI_MILLS) { if (mill.includes(index)) { if (board[mill[0]] === icon && board[mill[1]] === icon && board[mill[2]] === icon) return true; } } return false; }
function isDaadiPieceInMill(board, index, icon) { return checkDaadiMill(board, index, icon); }
function hasNonMillPieces(board, icon) { for (let i = 0; i < 24; i++) { if (board[i] === icon && !isDaadiPieceInMill(board, i, icon)) return true; } return false; }

// --- PHASE RACE ENGINE ---
function generatePhase10Deck() {
    const colors = ['red', 'blue', 'green', 'yellow']; let deck = [];
    for (let i = 0; i < 2; i++) { colors.forEach(color => { for (let v = 1; v <= 12; v++) deck.push({ color, value: v }); }); }
    for (let i = 0; i < 8; i++) deck.push({ color: 'black', value: 'Wild' });
    for (let i = 0; i < 4; i++) deck.push({ color: 'black', value: 'Skip' });
    return deck.sort(() => Math.random() - 0.5);
}

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    
    socket.on('joinRoom', ({ roomId, nickname, gameType }) => {
        socket.join(roomId);
        if (!activeGames[roomId]) {
            activeGames[roomId] = { gameType: gameType || 'sequence', host: socket.id, players: {}, turnOrder: [], currentTurnIndex: 0, currentTurnPlayer: null, isLive: false, gameOver: false };
        }
        const game = activeGames[roomId];
        game.gameType = gameType; 
        if (game.players[nickname]) game.players[nickname].socketId = socket.id;
        else game.players[nickname] = { socketId: socket.id, team: 'blue', hand: [], phase: 1, hasLaidPhase: false, hasDrawn: false };
        
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
        
        game.turnOrder = [];
        if (game.gameType === 'sequence') {
            let pts = {}; Object.keys(game.players).forEach(u => { let t = game.players[u].team; if(!pts[t]) pts[t]=[]; pts[t].push(u); });
            let max = Math.max(...Object.keys(pts).map(t => pts[t].length), 0);
            for (let i=0; i<max; i++) Object.keys(pts).forEach(t => { if(pts[t][i]) game.turnOrder.push(pts[t][i]); });
        } else if (game.gameType === 'daadi') {
            const playerNames = Object.keys(game.players);
            if (playerNames.length < 2) return; 
            game.turnOrder = [playerNames[0], playerNames[1]];
        } else {
            game.turnOrder = Object.keys(game.players); 
        }
        
        if (game.turnOrder.length === 0) return; 
        game.currentTurnIndex = 0; game.currentTurnPlayer = game.turnOrder[0]; game.isLive = true; game.gameOver = false;

        if (game.gameType === 'sequence') {
            game.boardState = generateSeqBoard(); game.deck = generateSeqDeck(); game.discardPile = [];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.deck.pop()); });
        } else if (game.gameType === 'uno') {
            game.unoDeck = generateUnoDeck(); game.direction = 1; game.drawStack = 0;
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.unoDeck.pop()); });
            let top = game.unoDeck.pop(); while(top.color === 'black') { game.unoDeck.unshift(top); top = game.unoDeck.pop(); }
            game.topCard = top;
        } else if (game.gameType === 'daadi') {
            game.daadiBoard = Array(24).fill(null);
            game.daadiPlayers = { [game.turnOrder[0]]: { icon: '🦁', unplaced: 9 }, [game.turnOrder[1]]: { icon: '🐯', unplaced: 9 } };
            game.removingPlayer = null;
        } else if (game.gameType === 'phase10') {
            game.phaseDeck = generatePhase10Deck();
            game.phaseDiscard = [game.phaseDeck.pop()];
            game.laidPhases = {}; 
            Object.values(game.players).forEach(p => {
                p.hand = []; p.phase = 1; p.hasLaidPhase = false; p.hasDrawn = false;
                for(let i=0; i<10; i++) p.hand.push(game.phaseDeck.pop());
            });
        }
        emitGameState(roomId);
    });

    // --- SEQUENCE & UNO MOVES ---
    socket.on('playMove', ({ roomId, username, boardIndex, cardPlayed }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'sequence' || game.currentTurnPlayer !== username) return;
        const player = game.players[username]; const space = game.boardState[boardIndex];
        const isTwoEyed = cardPlayed === '♣-J' || cardPlayed === '♦-J'; const isOneEyed = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        if ((space.card === cardPlayed || isTwoEyed) && !space.team && space.card !== 'FREE') game.boardState[boardIndex].team = player.team;
        else if (isOneEyed && space.team && space.team !== player.team && space.card !== 'FREE') { if (space.locked) return; game.boardState[boardIndex].team = null; } else return; 
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

    socket.on('playUnoMove', ({ roomId, username, card, chosenColor }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'uno' || game.currentTurnPlayer !== username) return;
        const isMatch = card.color === 'black' || card.color === game.topCard.color || card.value === game.topCard.value;
        if (!isMatch) return;
        const p = game.players[username]; const cIdx = p.hand.findIndex(c => c.color === card.color && c.value === card.value);
        if (cIdx !== -1) p.hand.splice(cIdx, 1);
        game.topCard = { color: card.color === 'black' ? chosenColor : card.color, value: card.value };
        if (p.hand.length === 0) { game.gameOver = true; io.to(roomId).emit('gameOver', `${username} Wins!`); emitGameState(roomId); return; }
        
        let steps = 1;
        if (card.value === '+2') game.drawStack += 2;
        else if (card.value === '+4') game.drawStack += 4;
        else if (card.value === 'Rev') { game.direction *= -1; if(game.turnOrder.length === 2) steps = 2; }
        else if (card.value === 'Skip') steps = 2;
        
        let dir = game.direction * steps; game.currentTurnIndex = (game.currentTurnIndex + dir + (game.turnOrder.length * 5)) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        emitGameState(roomId);
    });

    socket.on('drawUnoCard', ({ roomId, username }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'uno' || game.currentTurnPlayer !== username) return;
        let cardsToDraw = game.drawStack > 0 ? game.drawStack : 1;
        for (let i = 0; i < cardsToDraw; i++) {
            if(game.unoDeck.length === 0) game.unoDeck = generateUnoDeck(); 
            game.players[username].hand.push(game.unoDeck.pop()); 
        }
        game.drawStack = 0;
        game.currentTurnIndex = (game.currentTurnIndex + game.direction + game.turnOrder.length) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        emitGameState(roomId);
    });

    // --- DAADI MOVES ---
    socket.on('playDaadiMove', ({ roomId, username, action, index, fromIndex }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'daadi' || game.currentTurnPlayer !== username) return;
        const myData = game.daadiPlayers[username]; const myIcon = myData.icon;
        const oppName = game.turnOrder.find(n => n !== username); const oppIcon = game.daadiPlayers[oppName].icon;

        if (action === 'remove') {
            if (game.removingPlayer !== username || game.daadiBoard[index] !== oppIcon) return;
            if (isDaadiPieceInMill(game.daadiBoard, index, oppIcon) && hasNonMillPieces(game.daadiBoard, oppIcon)) return;
            game.daadiBoard[index] = null; game.removingPlayer = null;
            let oppPiecesOnBoard = game.daadiBoard.filter(c => c === oppIcon).length;
            if (game.daadiPlayers[oppName].unplaced === 0 && oppPiecesOnBoard < 3) {
                game.gameOver = true; io.to(roomId).emit('gameOver', `${username} Wins!`);
            } else { game.currentTurnIndex = (game.currentTurnIndex + 1) % 2; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex]; }
        } else if (action === 'place') {
            if (myData.unplaced <= 0 || game.daadiBoard[index]) return;
            game.daadiBoard[index] = myIcon; myData.unplaced--;
            if (checkDaadiMill(game.daadiBoard, index, myIcon)) game.removingPlayer = username;
            else { game.currentTurnIndex = (game.currentTurnIndex + 1) % 2; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex]; }
        } else if (action === 'move') {
            if (myData.unplaced > 0 || game.daadiBoard[fromIndex] !== myIcon || game.daadiBoard[index]) return;
            let myPiecesOnBoard = game.daadiBoard.filter(c => c === myIcon).length;
            if (myPiecesOnBoard > 3 && !DAADI_ADJ[fromIndex].includes(index)) return;
            game.daadiBoard[fromIndex] = null; game.daadiBoard[index] = myIcon;
            if (checkDaadiMill(game.daadiBoard, index, myIcon)) game.removingPlayer = username;
            else { game.currentTurnIndex = (game.currentTurnIndex + 1) % 2; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex]; }
        }
        emitGameState(roomId);
    });

    // --- PHASE RACE MOVES ---
    socket.on('drawPhase10', ({ roomId, username, source }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'phase10' || game.currentTurnPlayer !== username) return;
        const p = game.players[username]; if (p.hasDrawn) return;
        if (source === 'deck') {
            if (game.phaseDeck.length === 0) game.phaseDeck = generatePhase10Deck();
            p.hand.push(game.phaseDeck.pop());
        } else if (source === 'discard' && game.phaseDiscard.length > 0) {
            p.hand.push(game.phaseDiscard.pop());
        }
        p.hasDrawn = true; emitGameState(roomId);
    });

    socket.on('layPhase10', ({ roomId, username, selectedIndices }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'phase10' || game.currentTurnPlayer !== username) return;
        const p = game.players[username]; if (!p.hasDrawn || p.hasLaidPhase) return;
        if (selectedIndices.length >= 6) {
            p.hasLaidPhase = true; let laidCards = [];
            selectedIndices.sort((a,b) => b - a).forEach(idx => { if (idx >= 0 && idx < p.hand.length) laidCards.push(p.hand.splice(idx, 1)[0]); });
            game.laidPhases[username] = laidCards.reverse();
        }
        emitGameState(roomId);
    });

    socket.on('hitPhase10', ({ roomId, username, targetUser, cardIndex }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'phase10' || game.currentTurnPlayer !== username) return;
        const p = game.players[username]; if (!p.hasDrawn || !p.hasLaidPhase) return;
        if (cardIndex >= 0 && cardIndex < p.hand.length && game.laidPhases[targetUser]) {
            game.laidPhases[targetUser].push(p.hand.splice(cardIndex, 1)[0]);
            if (p.hand.length === 0) {
                p.phase++;
                if (p.phase > 10) { game.gameOver = true; io.to(roomId).emit('gameOver', `${username} completed Phase 10 and Wins!`); } 
                else {
                    game.phaseDeck = generatePhase10Deck(); game.phaseDiscard = [game.phaseDeck.pop()]; game.laidPhases = {};
                    Object.values(game.players).forEach(player => {
                        if (player.hasLaidPhase && player !== p) player.phase++;
                        player.hand = []; player.hasLaidPhase = false; player.hasDrawn = false;
                        for(let i=0; i<10; i++) player.hand.push(game.phaseDeck.pop());
                    });
                }
            }
        }
        emitGameState(roomId);
    });

    socket.on('discardPhase10', ({ roomId, username, cardIndex }) => {
        const game = activeGames[roomId]; if (!game || game.gameOver || game.gameType !== 'phase10' || game.currentTurnPlayer !== username) return;
        const p = game.players[username]; if (!p.hasDrawn) return;
        if (cardIndex >= 0 && cardIndex < p.hand.length) {
            game.phaseDiscard.push(p.hand.splice(cardIndex, 1)[0]); p.hasDrawn = false;
            if (p.hand.length === 0) {
                if (p.hasLaidPhase) p.phase++;
                if (p.phase > 10) { game.gameOver = true; io.to(roomId).emit('gameOver', `${username} completed Phase 10 and Wins!`); } 
                else {
                    game.phaseDeck = generatePhase10Deck(); game.phaseDiscard = [game.phaseDeck.pop()]; game.laidPhases = {};
                    Object.values(game.players).forEach(player => {
                        if (player.hasLaidPhase && player !== p) player.phase++;
                        player.hand = []; player.hasLaidPhase = false; player.hasDrawn = false;
                        for(let i=0; i<10; i++) player.hand.push(game.phaseDeck.pop());
                    });
                }
            }
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        }
        emitGameState(roomId);
    });

    // --- SHARED ROUTER ---
    socket.on('rematch', ({ roomId }) => {
        const game = activeGames[roomId]; if (!game || !game.gameOver) return;
        game.gameOver = false;
        
        if(game.gameType === 'sequence') {
            game.boardState = generateSeqBoard(); game.deck = generateSeqDeck(); game.discardPile = [];
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.deck.pop()); });
        } else if (game.gameType === 'uno') {
            game.unoDeck = generateUnoDeck(); game.direction = 1; game.drawStack = 0;
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
            Object.values(game.players).forEach(p => { p.hand = []; for(let i=0; i<7; i++) p.hand.push(game.unoDeck.pop()); });
            let top = game.unoDeck.pop(); while(top.color === 'black') { game.unoDeck.unshift(top); top = game.unoDeck.pop(); }
            game.topCard = top;
        } else if (game.gameType === 'daadi') {
            game.daadiBoard = Array(24).fill(null);
            game.daadiPlayers[game.turnOrder[0]].unplaced = 9; game.daadiPlayers[game.turnOrder[1]].unplaced = 9;
            game.removingPlayer = null;
            game.currentTurnIndex = (game.currentTurnIndex + 1) % 2; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        } else if (game.gameType === 'phase10') {
            game.phaseDeck = generatePhase10Deck(); game.phaseDiscard = [game.phaseDeck.pop()]; game.laidPhases = {};
            game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length; game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
            Object.values(game.players).forEach(p => {
                p.hand = []; p.phase = 1; p.hasLaidPhase = false; p.hasDrawn = false;
                for(let i=0; i<10; i++) p.hand.push(game.phaseDeck.pop());
            });
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
            } else if (game.gameType === 'uno') {
                let pList = Object.keys(game.players).map(n => ({ name: n, cardCount: game.players[n].hand.length }));
                payload = { ...payload, hand: p.hand, topCard: game.topCard, playerList: pList, drawStack: game.drawStack };
            } else if (game.gameType === 'daadi') {
                let pList = game.turnOrder.map(n => ({ name: n, icon: game.daadiPlayers[n].icon, unplaced: game.daadiPlayers[n].unplaced, onBoard: game.daadiBoard.filter(c => c === game.daadiPlayers[n].icon).length }));
                payload = { ...payload, board: game.daadiBoard, removingPlayer: game.removingPlayer, playersList: pList, me: { name: name, ...game.daadiPlayers[name] } };
            } else if (game.gameType === 'phase10') {
                let pList = Object.keys(game.players).map(n => ({ name: n, phase: game.players[n].phase, hasLaidPhase: game.players[n].hasLaidPhase }));
                payload = { ...payload, hand: p.hand, topCard: game.phaseDiscard[game.phaseDiscard.length - 1], laidPhases: game.laidPhases, playerList: pList, me: { name: name, ...p } };
            }
            io.to(p.socketId).emit('gameState', payload);
        });
    }
});

server.listen(3000, () => console.log('Multi-Game Server Hub Running!'));
