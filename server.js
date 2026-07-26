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

function generateBoard() {
    let boardCards = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            boardCards.push(`${suit}-${rank}`);
            boardCards.push(`${suit}-${rank}`);
        });
    });
    boardCards.sort(() => Math.random() - 0.5); // Shuffle
    
    let boardState = Array(100).fill(null);
    let cardIndex = 0;
    for (let i = 0; i < 100; i++) {
        if (i === 0 || i === 9 || i === 90 || i === 99) {
            boardState[i] = { card: 'FREE', team: null };
        } else {
            boardState[i] = { card: boardCards[cardIndex], team: null };
            cardIndex++;
        }
    }
    return boardState;
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
    
    // 1. Join a specific Room (Updated to default new players to 'blue')
    socket.on('joinRoom', ({ roomId, nickname }) => {
        socket.join(roomId);
        
        if (!activeGames[roomId]) {
            activeGames[roomId] = {
                host: socket.id,
                players: {},
                boardState: [],
                deck: [],
                currentTurn: 'blue',
                isLive: false
            };
        }
        
        const game = activeGames[roomId];
        
        if (game.players[nickname]) {
            game.players[nickname].socketId = socket.id;
        } else {
            game.players[nickname] = { 
                socketId: socket.id, 
                team: 'blue', // Default them to blue so they show up instantly!
                hand: [] 
            };
        }
        
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, 
            team: game.players[name].team,
            isHost: game.host === game.players[name].socketId
        })));
    });

    // 2. Handle Team Randomization
    socket.on('randomizeTeams', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game) return;

        const availableTeams = ['blue', 'red', 'green'];
        Object.keys(game.players).forEach(name => {
            // Randomly assign one of the 3 teams
            const randomTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];
            game.players[name].team = randomTeam;
        });

        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, team: game.players[name].team, isHost: game.host === game.players[name].socketId
        })));
    });

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

    // 2. Handle Drag-and-Drop Team Assignments
    socket.on('updateTeams', ({ roomId, updatedPlayers }) => {
        const game = activeGames[roomId];
        if (!game) return;
        
        // Update the server state with the new team selections
        updatedPlayers.forEach(p => {
            if (game.players[p.name]) {
                game.players[p.name].team = p.team;
            }
        });
        
        // Sync the changes to everyone in the lobby
        io.to(roomId).emit('lobbyUpdate', Object.keys(game.players).map(name => ({
            name, team: game.players[name].team
        })));
    });

    // 3. Start the Game
    socket.on('startGame', ({ roomId }) => {
        const game = activeGames[roomId];
        if (!game || game.isLive) return;
        
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

    // 4. Play a Move
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

        // Toggle turn (Assumes red/blue teams, you can expand this to include green later)
        game.currentTurn = game.currentTurn === 'blue' ? 'red' : 'blue';
        
        let winner = checkWinCondition(game.boardState);
        if (winner) io.to(roomId).emit('gameOver', winner);

        // Update everyone with the new board and last discarded card
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
