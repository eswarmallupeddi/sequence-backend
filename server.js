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

io.on('connection', (socket) => {
    // Rejoin / Join Logic
    socket.on('joinGame', (data) => {
        const { username, team } = data;
        
        // If player already exists (reconnection), just update socket ID
        if (players[username]) {
            players[username].socketId = socket.id;
        } else {
            // New player
            let hand = [];
            for (let i = 0; i < 7; i++) hand.push(deck.pop());
            players[username] = { socketId: socket.id, team, hand };
        }
        
        socket.emit('gameState', { 
            board: boardState, 
            hand: players[username].hand, 
            turn: currentTurn,
            me: players[username]
        });
    });

    socket.on('playMove', (data) => {
        const { username, boardIndex, cardPlayed } = data;
        const player = players[username];
        
        if (currentTurn !== player.team) return;
        if (!player.hand.includes(cardPlayed)) return;

        const space = boardState[boardIndex];
        const isTwoEyedJack = cardPlayed === '♣-J' || cardPlayed === '♦-J';
        const isOneEyedJack = cardPlayed === '♠-J' || cardPlayed === '♥-J';

        // Standard Play or 2-Eyed Jack (Wild)
        if ((space.card === cardPlayed || isTwoEyedJack) && !space.team && space.card !== 'FREE') {
            boardState[boardIndex].team = player.team;
        } 
        // 1-Eyed Jack (Remove opponent chip)
        else if (isOneEyedJack && space.team && space.team !== player.team && space.card !== 'FREE') {
            boardState[boardIndex].team = null;
        } else {
            return; // Invalid move
        }

        // Remove card from hand, draw new one
        player.hand = player.hand.filter(c => c !== cardPlayed);
        if (deck.length > 0) player.hand.push(deck.pop());

        // Change Turn
        currentTurn = currentTurn === 'red' ? 'blue' : 'red';
        
        let winner = checkWinCondition();
        if (winner) io.emit('gameOver', winner);

        // Update everyone
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
});

server.listen(3000, () => console.log('Sequence Server Running'));
