const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- Game Constants & Setup ---
const SUITS = ['♠', '♥', '♣', '♦'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Q', 'K', 'A'];
// Jacks: Spades/Hearts are 1-eyed (Remove), Clubs/Diamonds are 2-eyed (Wild)
const JACKS = ['♠-J', '♥-J', '♣-J', '♦-J']; 

let deck = [];
let boardState = [];
let players = {};
let currentTurn = 'red'; // 'red' or 'blue'

// Generate a random but valid Sequence board (each non-Jack card appears twice)
function generateBoard() {
    let boardCards = [];
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            boardCards.push(`${suit}-${rank}`);
            boardCards.push(`${suit}-${rank}`);
        });
    });
    // Shuffle board cards
    boardCards.sort(() => Math.random() - 0.5);
    
    boardState = Array(100).fill(null);
    let cardIndex = 0;
    for (let i = 0; i < 100; i++) {
        if (i === 0 || i === 9 || i === 90 || i === 99) {
            boardState[i] = { card: 'FREE', team: null };
        } else {
            boardState[i] = { card: boardCards[cardIndex], team: null };
            cardIndex++;
        }
    }
}

function generateDeck() {
    deck = [];
    for (let i = 0; i < 2; i++) { // Two standard decks
        SUITS.forEach(suit => {
            RANKS.forEach(rank => deck.push(`${suit}-${rank}`));
        });
        JACKS.forEach(jack => deck.push(jack));
    }
    deck.sort(() => Math.random() - 0.5);
}

function checkWinCondition() {
    // A standard Sequence is 5 in a row. For brevity, this server logic 
    // will just notify clients when any 5-in-a-row is detected.
    const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
    
    for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
            let index = r * 10 + c;
            let team = boardState[index].team;
            if (boardState[index].card === 'FREE') continue; // Handled as wildcard below
            if (!team) continue;

            for (let [dr, dc] of directions) {
                let count = 0;
                for (let i = 0; i < 5; i++) {
                    let nr = r + dr * i;
                    let nc = c + dc * i;
                    if (nr < 0 || nr >= 10 || nc < 0 || nc >= 10) break;
                    let nIndex = nr * 10 + nc;
                    let nTeam = boardState[nIndex].team;
                    if (nTeam === team || boardState[nIndex].card === 'FREE') {
                        count++;
                    } else {
                        break;
                    }
                }
                if (count === 5) return team;
            }
        }
    }
    return null;
}

generateBoard();
generateDeck();

let isGameStarted = false;

io.on('connection', (socket) => {
    // 1. Join Lobby / Reconnection
    socket.on('joinGame', (data) => {
        const { username, team } = data;
        
        if (players[username]) {
            players[username].socketId = socket.id; // Reconnect
        } else {
            players[username] = { socketId: socket.id, team: team, hand: [] }; // New Player
        }
        
        // Broadcast the updated lobby list to everyone
        const lobbyData = Object.keys(players).map(k => ({ name: k, team: players[k].team }));
        io.emit('lobbyUpdate', lobbyData);

        // If they refreshed and the game is already live, jump them straight back in
        if (isGameStarted) {
            socket.emit('gameState', { 
                board: boardState, 
                hand: players[username].hand, 
                turn: currentTurn,
                me: players[username]
            });
        }
    });

    // 2. Start Game Command
    socket.on('startGame', () => {
        if (isGameStarted) return;
        isGameStarted = true;

        // Deal 7 cards to every player in the lobby
        Object.values(players).forEach(p => {
            for (let i = 0; i < 7; i++) {
                if (deck.length > 0) p.hand.push(deck.pop());
            }
        });

        // Send the official game state to all players to reveal the board
        Object.keys(players).forEach(name => {
            const p = players[name];
            io.to(p.socketId).emit('gameState', {
                board: boardState,
                hand: p.hand,
                turn: currentTurn,
                me: p
            });
        });
    });

    // 3. Gameplay Logic (Paste your existing socket.on('playMove') logic here exactly as it was)
    socket.on('playMove', (data) => {
        const { username, boardIndex, cardPlayed } = data;
        const player = players[username];
        
        if (currentTurn !== player.team) return;
        if (!player.hand.includes(cardPlayed)) return;

        const space = boardState[boardIndex];
        const isTwoEyedJack = cardPlayed === '♣-J' || cardPlayed === '♦-J';
        const isOneEyedJack = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        if ((space.card === cardPlayed || isTwoEyedJack) && !space.team && space.card !== 'FREE') {
            boardState[boardIndex].team = player.team;
        } else if (isOneEyedJack && space.team && space.team !== player.team && space.card !== 'FREE') {
            boardState[boardIndex].team = null;
        } else {
            return; 
        }

        player.hand = player.hand.filter(c => c !== cardPlayed);
        if (deck.length > 0) player.hand.push(deck.pop());

        currentTurn = currentTurn === 'red' ? 'blue' : 'red';
        
        let winner = checkWinCondition();
        if (winner) io.emit('gameOver', winner);

        Object.keys(players).forEach(name => {
            const p = players[name];
            io.to(p.socketId).emit('gameState', {
                board: boardState, hand: p.hand, turn: currentTurn, me: p
            });
        });
    });
});

server.listen(3000, () => console.log('Sequence Server Running'));
