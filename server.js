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

// The master object holding all active games by Room ID
const activeGames = {}; 

// Replace the old generateBoard function with this:
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

function generateBoard() {
    return STANDARD_BOARD_LAYOUT.map(card => ({ card: card, team: null }));
}

function generateDeck() {
    let deck = [];
    for (let i = 0; i < 2; i++) { 
        SUITS.forEach(suit => RANKS.forEach(rank => deck.push(`${suit}-${rank}`)));
        JACKS.forEach(jack => deck.push(jack));
    }
    deck.sort(() => Math.random() - 0.5); // Shuffle
    return deck;
}

function checkWinCondition(boardState) {
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            let index = r * 10 + c;
            let team = boardState[index].team;
            if (boardState[index].card === 'FREE' || !team) continue;

            for (let [dr, dc] of directions) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    let nr = r + dr * i;
                    let nc = c + dc * i;
                    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) break;
                    let nIndex = nr * 10 + nc;
                    let nTeam = boardState[nIndex].team;
                    if (nTeam === team || boardState[nIndex].card === 'FREE') count++;
                    else break;
                }
                if (count === 5) return team;
            }
        }
    }
    return null;
}

io.on('connection', (socket) => {
    console.log(`🟢 SERVER: A player connected! ID: ${socket.id}`);

    // 1. Join a specific Room
    socket.on('joinRoom', ({ roomId, nickname }) => {
        console.log(`🔵 SERVER: ${nickname} requested to join room ${roomId}`);
        socket.join(roomId);
        
        // If room doesn't exist, create it
        if (!activeGames[roomId]) {
            activeGames[roomId] = {
                host: socket.id,
                players: {},
                boardState: [],
                deck: [],
                currentTurn: 'blue', // Default starting team
                isLive: false
            };
        }
        
        const game = activeGames[roomId];
        
        // Add new player or update socket ID if reconnecting
        if (game.players[nickname]) {
            game.players[nickname].socketId = socket.id;
        } else {
            game.players[nickname] = { 
                socketId: socket.id, 
                team: 'blue', // Default to blue so they show up instantly in the UI
                hand: [] 
            };
        }
        
        // Broadcast lobby update to ONLY this room
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, 
            team: game.players[name].team,
            isHost: game.host === game.players[name].socketId
        })));

        // If they refreshed mid-game, send them the board immediately
        if (game.isLive) {
            socket.emit('gameState', {
                board: game.boardState,
                hand: game.players[nickname].hand,
                turn: game.currentTurn,
                me: game.players[nickname]
            });
        }
    });

    // 2. Handle Team Randomization
    socket.on('randomizeTeams', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game) return;

        const availableTeams = ['blue', 'red', 'green'];
        Object.keys(game.players).forEach(name => {
            const randomTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];
            game.players[name].team = randomTeam;
        });

        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, 
            team: game.players[name].team, 
            isHost: game.host === game.players[name].socketId
        })));
    });

    // 3. Handle Manual Team Updates (Drag-and-Drop or Clicking)
    socket.on('updateTeams', ({ roomId, updatedPlayers }) => {
        const game = activeGames[roomId];
        if (!game) return;
        
        updatedPlayers.forEach(p => {
            if (game.players[p.name]) {
                game.players[p.name].team = p.team;
            }
        });
        
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, 
            team: game.players[name].team,
            isHost: game.host === game.players[name].socketId
        })));
    });

    // 4. Start the Game
    socket.on('startGame', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game || game.isLive) return;
        const activeTeams = [...new Set(Object.values(game.players).map(p => p.team))];
        game.currentTurn = activeTeams[0] || 'blue'; // Start with whoever is first
        game.isLive = true;
        game.boardState = generateBoard();
        game.deck = generateDeck();
        
        // Deal 7 cards to everyone
        Object.values(game.players).forEach(p => {
            for (let i = 0; i < 7; i++) {
                if (game.deck.length > 0) p.hand.push(game.deck.pop());
            }
        });

        // Send the official game state to everyone in the room
        Object.keys(game.players).forEach(name => {
            const p = game.players[name];
            io.to(p.socketId).emit('gameState', {
                board: game.boardState,
                hand: p.hand,
                turn: game.currentTurn,
                me: p
            });
        });
    });

    // 5. Play a Move
    socket.on('playMove', ({ roomId, username, boardIndex, cardPlayed }) => {
        const game = activeGames[roomId];
        if (!game) return;

        const player = game.players[username];
        if (game.currentTurn !== player.team || !player.hand.includes(cardPlayed)) return;

        const space = game.boardState[boardIndex];
        const isTwoEyedJack = cardPlayed === '♣-J' || cardPlayed === '♦-J';
        const isOneEyedJack = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        if ((space.card === cardPlayed || isTwoEyedJack) && !space.team && space.card !== 'FREE') {
            game.boardState[boardIndex].team = player.team;
        } else if (isOneEyedJack && space.team && space.team !== player.team && space.card !== 'FREE') {
            game.boardState[boardIndex].team = null;
        } else return; 

        // Discard and draw
        player.hand = player.hand.filter(c => c !== cardPlayed);
        if (game.deck.length > 0) player.hand.push(game.deck.pop());

        // Toggle turn
        const teamsPlaying = [...new Set(Object.values(game.players).map(p => p.team))];
        if (teamsPlaying.length > 0) {
            let currentIndex = teamsPlaying.indexOf(game.currentTurn);
            let nextIndex = (currentIndex + 1) % teamsPlaying.length;
            game.currentTurn = teamsPlaying[nextIndex];
        }        
        
        let winner = checkWinCondition(game.boardState);
        if (winner) io.to(roomId).emit('gameOver', winner);

        Object.keys(game.players).forEach(name => {
            const p = game.players[name];
            io.to(p.socketId).emit('gameState', {
                board: game.boardState, 
                hand: p.hand, 
                turn: game.currentTurn, 
                me: p,
                lastDiscard: cardPlayed,
                cardsLeft: game.deck.length
            });
        });
    });
});

server.listen(3000, () => console.log('Sequence Server Running with Rooms!'));
