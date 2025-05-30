import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { io } from 'socket.io-client';

function App() {
  // Chess game state
  const [chessGame, setChessGame] = useState(new Chess());
  const [moveHistory, setMoveHistory] = useState([]);
  const [status, setStatus] = useState('');
  const [capturedPieces, setCapturedPieces] = useState({ w: [], b: [] });
  
  // For highlighting squares (for move hints or checkmate)
  const [highlightedSquares, setHighlightedSquares] = useState({});
  // For click/tap moves – store the currently selected square
  const [selectedSquare, setSelectedSquare] = useState(null);

  // Lobby & multiplayer state
  const [inLobby, setInLobby] = useState(true);
  const [gameId, setGameId] = useState('');
  const [lobbyGameKey, setLobbyGameKey] = useState('');
  const [playerColor, setPlayerColor] = useState(''); // 'w' or 'b'
  const [error, setError] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Socket reference
  const socketRef = useRef(null);

  // --- Helper Functions for Chess.js API Compatibility ---
  const gameIsOver = (game) => {
    if (typeof game.game_over === 'function') return game.game_over();
    if (typeof game.gameOver === 'function') return game.gameOver();
    return false;
  };

  const isCheckmate = (game) => {
    if (typeof game.in_checkmate === 'function') return game.in_checkmate();
    if (typeof game.isCheckmate === 'function') return game.isCheckmate();
    return false;
  };

  const isDraw = (game) => {
    if (typeof game.in_draw === 'function') return game.in_draw();
    if (typeof game.isDraw === 'function') return game.isDraw();
    return false;
  };

  const isCheck = (game) => {
    if (typeof game.in_check === 'function') return game.in_check();
    if (typeof game.isCheck === 'function') return game.isCheck();
    return false;
  };
  // --- End Helper Functions ---

  // Initialize Socket.IO connection
  useEffect(() => {
    socketRef.current = io('http://localhost:3000'); // Update URL if needed
    const socket = socketRef.current;

    socket.on('gameCreated', ({ gameId, color }) => {
      setGameId(gameId);
      setPlayerColor(color);
      console.log(`Game created! Share this key: ${gameId}`);
    });

    socket.on('gameJoined', ({ gameId, color }) => {
      setGameId(gameId);
      if (!playerColor) setPlayerColor(color);
      console.log(`Joined game ${gameId} as ${color}`);
    });

    socket.on('startGame', ({ gameId, players }) => {
      console.log('Game started with players:', players);
      setInLobby(false);
    });

    // Use functional update so we always work with the latest game state
    socket.on('move', (move) => {
      setChessGame((prevGame) => {
        const newGame = new Chess(prevGame.fen());
        newGame.move(move);
        updateGameStatus(newGame);
        return newGame;
      });
      setMoveHistory((prev) => [...prev, move]);
      updateCapturedPieces(move);
      // Clear any click-based selection and move hints after a move is played
      setSelectedSquare(null);
      setHighlightedSquares({});
    });

    socket.on('errorMessage', (msg) => setError(msg));

    socket.on('opponentDisconnected', () => {
      alert('Opponent disconnected. You win by default!');
      setInLobby(true);
      resetGame();
    });

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update game status; if checkmate, highlight the checkmated king.
  const updateGameStatus = useCallback((gameInstance) => {
    if (isCheckmate(gameInstance)) {
      const losingColor = gameInstance.turn(); // Player to move is checkmated
      let kingSquare = null;
      const files = ['a','b','c','d','e','f','g','h'];
      const ranks = ['1','2','3','4','5','6','7','8'];
      for (let r = 0; r < ranks.length; r++) {
        for (let f = 0; f < files.length; f++) {
          const square = files[f] + ranks[r];
          const piece = gameInstance.get(square);
          if (piece && piece.type === 'k' && piece.color === losingColor) {
            kingSquare = square;
            break;
          }
        }
        if (kingSquare) break;
      }
      if (kingSquare) {
        // Highlight the checkmated king's square with a solid red background.
        setHighlightedSquares({ [kingSquare]: { backgroundColor: 'rgba(255,0,0,0.8)' } });
      }
      setStatus(`Checkmate! ${losingColor === 'w' ? 'Black' : 'White'} wins!`);
    } else if (isDraw(gameInstance)) {
      setStatus('Draw!');
    } else if (isCheck(gameInstance)) {
      setStatus(`Check! ${gameInstance.turn() === 'w' ? 'White' : 'Black'} to move`);
    } else {
      setStatus(`${gameInstance.turn() === 'w' ? 'White' : 'Black'} to move`);
    }
  }, []);

  // Update captured pieces state when a piece is taken.
  const updateCapturedPieces = useCallback((move) => {
    if (move.captured) {
      setCapturedPieces(prev => {
        const capturedColor = move.color === 'w' ? 'b' : 'w';
        return {
          ...prev,
          [capturedColor]: [...prev[capturedColor], move.captured]
        };
      });
    }
  }, []);

  // onDrop: Allow drag/drop moves only if it is your turn and the piece belongs to you.
  function onDrop(sourceSquare, targetSquare) {
    // Clear any highlighted move hints.
    setSelectedSquare(null);
    setHighlightedSquares({});

    if (chessGame.turn() !== playerColor) return false;

    const piece = chessGame.get(sourceSquare);
    if (!piece || piece.color !== playerColor) return false;

    const gameCopy = new Chess(chessGame.fen());
    const move = gameCopy.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q'
    });

    if (move === null) return false; // Illegal move

    setChessGame(gameCopy);
    setMoveHistory(prev => [...prev, move]);
    updateCapturedPieces(move);
    updateGameStatus(gameCopy);

    if (socketRef.current && gameId) {
      socketRef.current.emit('move', { gameId, move });
    }

    return true;
  }

  // handleSquareClick handles tap/click based moves.
  const handleSquareClick = (square) => {
    // If there's already a selected square, try to make a move.
    if (selectedSquare) {
      // If clicking the same square, deselect.
      if (selectedSquare === square) {
        setSelectedSquare(null);
        setHighlightedSquares({});
        return;
      }

      // Check if the move from selectedSquare to this square is valid.
      const moves = chessGame.moves({ square: selectedSquare, verbose: true });
      const validMove = moves.find((m) => m.to === square);
      if (validMove) {
        // Execute the move.
        const gameCopy = new Chess(chessGame.fen());
        const move = gameCopy.move({
          from: selectedSquare,
          to: square,
          promotion: 'q'
        });
        if (move) {
          setChessGame(gameCopy);
          setMoveHistory(prev => [...prev, move]);
          updateCapturedPieces(move);
          updateGameStatus(gameCopy);
          if (socketRef.current && gameId) {
            socketRef.current.emit('move', { gameId, move });
          }
        }
        setSelectedSquare(null);
        setHighlightedSquares({});
        return;
      } else {
        // If not a valid move, check if the tapped square has one of your pieces.
        const piece = chessGame.get(square);
        if (piece && piece.color === playerColor) {
          setSelectedSquare(square);
          highlightMoves(square);
          return;
        }
        // Otherwise, clear selection.
        setSelectedSquare(null);
        setHighlightedSquares({});
      }
    } else {
      // No square is selected yet. If the tapped square has one of your pieces, select it.
      const piece = chessGame.get(square);
      if (piece && piece.color === playerColor) {
        setSelectedSquare(square);
        highlightMoves(square);
      }
    }
  };

  // highlightMoves builds and sets highlightedSquares for a given square.
  const highlightMoves = (square) => {
    const moves = chessGame.moves({ square, verbose: true });
    if (moves.length === 0) {
      setHighlightedSquares({});
      return;
    }
    const newHighlights = {};
    moves.forEach(move => {
      // If the move captures a piece, show a red gradient.
      if (move.captured) {
        newHighlights[move.to] = {
          background: 'radial-gradient(circle, rgba(255,0,0,0.4) 36%, transparent 40%)',
          borderRadius: '50%'
        };
      } else {
        newHighlights[move.to] = {
          background: 'radial-gradient(circle, rgba(0,255,0,0.4) 36%, transparent 40%)',
          borderRadius: '50%'
        };
      }
    });
    // Highlight the selected square itself.
    newHighlights[square] = { backgroundColor: 'rgba(0,255,0,0.4)' };
    setHighlightedSquares(newHighlights);
  };

  // Reset the game to its initial state.
  function resetGame() {
    const newGame = new Chess();
    setChessGame(newGame);
    setMoveHistory([]);
    setCapturedPieces({ w: [], b: [] });
    setHighlightedSquares({});
    setSelectedSquare(null);
    updateGameStatus(newGame);
  }

  // Lobby: Create game handler.
  const handleCreateGame = (color) => {
    if (socketRef.current) {
      socketRef.current.emit('createGame', color);
      setPlayerColor(color);
    }
  };

  // Lobby: Join game handler.
  const handleJoinGame = () => {
    if (!lobbyGameKey.trim()) return;
    if (socketRef.current) {
      socketRef.current.emit('joinGame', { gameId: lobbyGameKey.trim() });
    }
  };

  // Render captured pieces using Unicode symbols.
  const renderCapturedPieces = (color) => {
    return capturedPieces[color].map((piece, idx) => (
      <span key={`${piece}-${idx}`} className="text-2xl">
        {piece === 'p' ? '♟' : 
         piece === 'n' ? '♞' :
         piece === 'b' ? '♝' :
         piece === 'r' ? '♜' :
         piece === 'q' ? '♛' : ''}
      </span>
    ));
  };

  // --- Lobby View ---
  if (inLobby) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
        <h1 className="text-4xl font-bold mb-4 text-gray-800">Chess Arena</h1>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => handleCreateGame('w')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Create Game as White
          </button>
          <button
            onClick={() => handleCreateGame('b')}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Create Game as Black
          </button>
        </div>
        {gameId && (
  <div className="mb-4">
    <p className="text-lg">Share this Game Key with your opponent:</p>
    <div className="flex items-center">
      <span className="font-mono text-xl text-gray-700 mr-2">{gameId}</span>
      <button
        onClick={() => {
          navigator.clipboard.writeText(gameId);
          // Optional: provide feedback to the user
          alert("Game key copied to clipboard!");
        }}
        className="flex items-center justify-center p-1 rounded hover:bg-gray-200"
        title="Copy Game Key"
      >
        {/* Copy Icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m0 0h8a2 2 0 012 2v4m0 0v10a2 2 0 01-2 2H8a2 2 0 01-2-2V9m12 0H8"
          />
        </svg>
      </button>
    </div>
  </div>
)}

        <div className="flex flex-col items-center">
          <input
            type="text"
            placeholder="Enter Game Key to Join"
            value={lobbyGameKey}
            onChange={(e) => setLobbyGameKey(e.target.value)}
            className="border p-2 rounded mb-2"
          />
          <button
            onClick={handleJoinGame}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            Join Game
          </button>
        </div>
        <p className="mt-4 text-gray-500">Waiting for both players to join...</p>
      </div>
    );
  }

  // --- Game View ---
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center p-8">
      <h1 className="text-4xl font-bold mb-6 text-gray-800">Chess.com</h1>
      <div className="mb-4 text-lg font-semibold p-2 rounded">
        {status}
      </div>



    {/* Mobile Move History Toggle */}
    <div className="w-full md:hidden flex justify-center mb-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="px-4 py-2 bg-indigo-500 text-white rounded shadow hover:bg-indigo-600 transition-colors"
        >
          {showHistory ? "Hide Move History" : "Show Move History"}
        </button>
      </div>
      {showHistory && (
        <div className="w-full md:hidden mb-4">
          <div className="bg-black shadow-lg rounded-lg p-4">
            <h2 className="text-lg font-semibold mb-2">Move History</h2>
            <div className="max-h-60 overflow-y-auto">
              {moveHistory.map((move, idx) => (
                <div key={idx} className="text-sm py-1 border-b">
                  {idx % 2 === 0 ? Math.floor(idx / 2 + 1) + '. ' : ''}
                  {move.san}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}


      <div className="flex gap-8">
        {/* Sidebar: Move History */}
        <div className="bg-white shadow-lg rounded-lg p-4 w-48">
          <h2 className="text-lg font-semibold mb-2">Move History</h2>
          <div className="h-96 overflow-y-auto">
            {moveHistory.map((move, idx) => (
              <div key={idx} className="text-sm py-1 border-b">
                {idx % 2 === 0 ? Math.floor(idx / 2 + 1) + '. ' : ''}
                {move.san}
              </div>
            ))}
          </div>
        </div>
        {/* Main Board */}
        <div className="bg-white shadow-lg rounded-lg p-6">
          <Chessboard
            position={chessGame.fen()}
            onPieceDrop={onDrop}
            onSquareClick={handleSquareClick}
            boardWidth={500}
            boardOrientation={playerColor === 'w' ? 'white' : 'black'}
            customSquareStyles={highlightedSquares}
            darkSquareStyle={{ backgroundColor: "#B58863" }}
            lightSquareStyle={{ backgroundColor: "#F0D9B5" }}
          />
          {/* Captured pieces display */}
          <div className="mt-4 flex justify-between">
            <div className="text-black">White captures: {renderCapturedPieces('w')}</div>
            <div className="text-black">Black captures: {renderCapturedPieces('b')}</div>
          </div>
          <div className="mt-4 flex justify-center">
            <button
              onClick={resetGame}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
            >
              Reset Board
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
