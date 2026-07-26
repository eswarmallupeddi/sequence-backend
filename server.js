const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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

const activeGames = {}; 

function generateBoard() {
    return STANDARD_BOARD_LAYOUT.map(card => ({ card: card, team: null }));
}

function generateDeck() {
    let deck = [];
    for (let i = 0; i < 2; i++) { 
        SUITS.forEach(suit => RANKS.forEach(rank => deck.push(`${suit}-${rank}`)));
        JACKS.forEach(jack => deck.push(jack));
    }
    deck.sort(() => Math.random() - 0.5); 
    return deck;
}

function countSequences(boardState, team) {
    let count = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]]; 

    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            for (let [dr, dc] of directions) {
                let isSequence = true;
                for (let i = 0; i < 5; i++) {
                    let nr = r + dr * i, nc = c + dc * i;
                    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) { isSequence = false; break; }
                    let cell = boardState[nr * 10 + nc];
                    if (cell.team !== team && cell.card !== 'FREE') { isSequence = false; break; }
                }
                
                if (isSequence) {
                    let pr = r - dr, pc = c - dc;
                    if (pr >= 0 && pr < 10 && pc >= 0 && pc < 10) {
                        let prevCell = boardState[pr * 10 + pc];
                        if (prevCell.team === team || prevCell.card === 'FREE') continue; 
                    }
                    count++;
                }
            }
        }
    }
    return count;
}

io.on('connection', (socket) => {
    console.log(`🟢 SERVER: A player connected! ID: ${socket.id}`);

    socket.on('joinRoom', ({ roomId, nickname }) => {
        console.log(`🔵 SERVER: ${nickname} requested to join room ${roomId}`);
        socket.join(roomId);
        
        if (!activeGames[roomId]) {
            activeGames[roomId] = {
                host: socket.id,
                players: {},
                boardState: [],
                deck: [],
                turnOrder: [],
                currentTurnIndex: 0,
                currentTurnPlayer: null,
                isLive: false,
                gameOver: false
            };
        }
        
        const game = activeGames[roomId];
        
        if (game.players[nickname]) {
            game.players[nickname].socketId = socket.id;
        } else {
            game.players[nickname] = { 
                socketId: socket.id, 
                team: 'blue', 
                hand: [] 
            };
        }
        
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, 
            team: game.players[name].team,
            isHost: game.host === game.players[name].socketId
        })));

        if (game.isLive) {
            socket.emit('gameState', {
                board: game.boardState,
                hand: game.players[nickname].hand,
                turnPlayer: game.currentTurnPlayer,
                turnTeam: game.players[game.currentTurnPlayer].team,
                me: game.players[nickname],
                isGameOver: game.gameOver,
                scores: {
                    'red': countSequences(game.boardState, 'red'),
                    'blue': countSequences(game.boardState, 'blue'),
                    'green': countSequences(game.boardState, 'green')
                }
            });
        }
    });

    socket.on('randomizeTeams', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game) return;
        const availableTeams = ['blue', 'red', 'green'];
        Object.keys(game.players).forEach(name => {
            game.players[name].team = availableTeams[Math.floor(Math.random() * availableTeams.length)];
        });
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, team: game.players[name].team, isHost: game.host === game.players[name].socketId
        })));
    });

    socket.on('updateTeams', ({ roomId, updatedPlayers }) => {
        const game = activeGames[roomId];
        if (!game) return;
        updatedPlayers.forEach(p => {
            if (game.players[p.name]) game.players[p.name].team = p.team;
        });
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, team: game.players[name].team, isHost: game.host === game.players[name].socketId
        })));
    });

    socket.on('startGame', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game || game.isLive) return;
        
        // Interleaved Turn Order (e.g. Blue1 -> Red1 -> Green1 -> Blue2)
        let playersByTeam = {};
        Object.keys(game.players).forEach(username => {
            let t = game.players[username].team;
            if (!playersByTeam[t]) playersByTeam[t] = [];
            playersByTeam[t].push(username);
        });

        game.turnOrder = [];
        const activeTeams = Object.keys(playersByTeam);
        let maxPlayersInTeam = Math.max(...activeTeams.map(t => playersByTeam[t].length), 0);
        
        for (let i = 0; i < maxPlayersInTeam; i++) {
            activeTeams.forEach(t => {
                if (playersByTeam[t][i]) {
                    game.turnOrder.push(playersByTeam[t][i]);
                }
            });
        }
        
        game.currentTurnIndex = 0;
        game.currentTurnPlayer = game.turnOrder[0];
        game.isLive = true;
        game.boardState = generateBoard();
        game.deck = generateDeck();
        
        Object.values(game.players).forEach(p => {
            for (let i = 0; i < 7; i++) {
                if (game.deck.length > 0) p.hand.push(game.deck.pop());
            }
        });

        Object.keys(game.players).forEach(name => {
            const p = game.players[name];
            io.to(p.socketId).emit('gameState', {
                board: game.boardState,
                hand: p.hand,
                turnPlayer: game.currentTurnPlayer,
                turnTeam: game.players[game.currentTurnPlayer].team,
                me: p,
                isGameOver: false,
                scores: { 'red': 0, 'blue': 0, 'green': 0 }
            });
        });
    });

    socket.on('playMove', ({ roomId, username, boardIndex, cardPlayed }) => {
        const game = activeGames[roomId];
        if (!game || game.gameOver) return;

        const player = game.players[username];
        
        if (game.currentTurnPlayer !== username || !player.hand.includes(cardPlayed)) return;

        const space = game.boardState[boardIndex];
        const isTwoEyedJack = cardPlayed === '♣-J' || cardPlayed === '♦-J';
        const isOneEyedJack = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        if ((space.card === cardPlayed || isTwoEyedJack) && !space.team && space.card !== 'FREE') {
            game.boardState[boardIndex].team = player.team;
        } else if (isOneEyedJack && space.team && space.team !== player.team && space.card !== 'FREE') {
            game.boardState[boardIndex].team = null;
        } else return; 

        // Find the exact index of the ONE card they played, and remove only that one
        const cardIndexInHand = player.hand.indexOf(cardPlayed);
        if (cardIndexInHand !== -1) {
            player.hand.splice(cardIndexInHand, 1);
        }
        if (game.deck.length > 0) player.hand.push(game.deck.pop());

        game.currentTurnIndex = (game.currentTurnIndex + 1) % game.turnOrder.length;
        game.currentTurnPlayer = game.turnOrder[game.currentTurnIndex];
        
        const scores = {
            'red': countSequences(game.boardState, 'red'),
            'blue': countSequences(game.boardState, 'blue'),
            'green': countSequences(game.boardState, 'green')
        };
        
        let winner = null;
        if (scores.red >= 2) winner = 'red';
        if (scores.blue >= 2) winner = 'blue';
        if (scores.green >= 2) winner = 'green';

        if (winner) {
            game.gameOver = true;
            io.to(roomId).emit('gameOver', winner);
        }

        Object.keys(game.players).forEach(name => {
            const p = game.players[name];
            io.to(p.socketId).emit('gameState', {
                board: game.boardState, 
                hand: p.hand, 
                turnPlayer: game.currentTurnPlayer, 
                turnTeam: game.players[game.currentTurnPlayer].team, 
                me: p,
                lastDiscard: cardPlayed,
                cardsLeft: game.deck.length,
                scores: scores,
                isGameOver: game.gameOver
            });
        });
    });
});

server.listen(3000, () => console.log('Sequence Server Running with Rooms!'));
