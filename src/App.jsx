import { useState, useEffect, useRef, useCallback } from 'react';

const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;
const PLAYER_SIZE = 40;
const BIRD_SIZE = 40;
const HITBOX_MARGIN = 12; // 여유 있는 히트박스
const PLAYER_Y = GAME_HEIGHT - PLAYER_SIZE - 20;

const GAME_STATES = {
  START: 'START',
  PLAYING: 'PLAYING',
  GAME_OVER: 'GAME_OVER',
};

export default function App() {
  const [gameState, setGameState] = useState(GAME_STATES.START);
  const [score, setScore] = useState(0);

  const requestRef = useRef();
  const lastTimeRef = useRef();

  const playerXRef = useRef(GAME_WIDTH / 2 - PLAYER_SIZE / 2);
  const birdsRef = useRef([]);
  const keysRef = useRef({});
  const difficultyRef = useRef({ speed: 3, spawnRate: 1500, lastSpawn: 0 });
  const scoreRef = useRef(0);
  const mouseXRef = useRef(null);
  const touchXRef = useRef(null);
  const touchDirectionRef = useRef(null); // 'left', 'right', 또는 null
  const leftButtonRef = useRef(null);
  const rightButtonRef = useRef(null);

  const playerDOMRef = useRef(null);
  const birdsDOMEscape = useRef(null);
  const gameBoardRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => { keysRef.current[e.key] = true; };
    const handleKeyUp = (e) => { keysRef.current[e.key] = false; };
    const handleMouseMove = (e) => {
      if (gameState !== GAME_STATES.PLAYING || !gameBoardRef.current) return;
      const rect = gameBoardRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      mouseXRef.current = Math.max(0, Math.min(GAME_WIDTH - PLAYER_SIZE, mouseX - PLAYER_SIZE / 2));
    };

    // 터치 종료 이벤트는 document 레벨에서 처리
    const handleTouchEnd = () => {
      touchDirectionRef.current = null;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gameState]);

  const resetGame = () => {
    playerXRef.current = GAME_WIDTH / 2 - PLAYER_SIZE / 2;
    birdsRef.current = [];
    difficultyRef.current = { speed: 4, spawnRate: 1200, lastSpawn: performance.now() };
    scoreRef.current = 0;
    mouseXRef.current = null;
    touchXRef.current = null;
    touchDirectionRef.current = null;
    setScore(0);
    setGameState(GAME_STATES.PLAYING);
  };

  const gameLoop = useCallback((time) => {
    if (gameState !== GAME_STATES.PLAYING) return;

    if (lastTimeRef.current != null) {
      updatePlayer();
      updateBirds(time);
      checkCollisions();
      renderPositions();
    }

    lastTimeRef.current = time;
    requestRef.current = requestAnimationFrame(gameLoop);
  }, [gameState]);

  useEffect(() => {
    if (gameState === GAME_STATES.PLAYING) {
      lastTimeRef.current = performance.now();
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, gameLoop]);

  const updatePlayer = () => {
    const speed = 7;
    let x = playerXRef.current;

    if (mouseXRef.current !== null) {
      playerXRef.current = mouseXRef.current;
    } else if (touchDirectionRef.current === 'left') {
      x -= speed;
    } else if (touchDirectionRef.current === 'right') {
      x += speed;
    } else if (keysRef.current['ArrowLeft'] || keysRef.current['a'] || keysRef.current['A']) {
      x -= speed;
    } else if (keysRef.current['ArrowRight'] || keysRef.current['d'] || keysRef.current['D']) {
      x += speed;
    }

    if (x < 0) x = 0;
    if (x > GAME_WIDTH - PLAYER_SIZE) x = GAME_WIDTH - PLAYER_SIZE;

    playerXRef.current = x;
  };

  const updateBirds = (time) => {
    const { speed, spawnRate, lastSpawn } = difficultyRef.current;

    if (time - lastSpawn > spawnRate) {
      const newX = Math.random() * (GAME_WIDTH - BIRD_SIZE);
      birdsRef.current.push({ id: Math.random(), x: newX, y: -BIRD_SIZE });
      difficultyRef.current.lastSpawn = time;

      difficultyRef.current.spawnRate = Math.max(300, spawnRate - 30);
      difficultyRef.current.speed += 0.05;
    }

    let newScore = scoreRef.current;

    birdsRef.current.forEach(bird => {
      bird.y += speed;
    });

    const remainingBirds = birdsRef.current.filter(bird => {
      if (bird.y > GAME_HEIGHT) {
        newScore += 1;
        return false;
      }
      return true;
    });

    if (newScore !== scoreRef.current) {
      scoreRef.current = newScore;
      setScore(newScore); // 비동기 상태 업데이트이므로 병목 없음
    }

    birdsRef.current = remainingBirds;
  };

  const checkCollisions = () => {
    const px = playerXRef.current;
    const py = PLAYER_Y;
    const pSize = PLAYER_SIZE;
    const m = HITBOX_MARGIN;

    for (let i = 0; i < birdsRef.current.length; i++) {
      const b = birdsRef.current[i];
      const bx = b.x;
      const by = b.y;
      const bSize = BIRD_SIZE;

      if (
        px + m < bx + bSize - m &&
        px + pSize - m > bx + m &&
        py + m < by + bSize - m &&
        py + pSize - m > by + m
      ) {
        setGameState(GAME_STATES.GAME_OVER);
        break;
      }
    }
  };

  const renderPositions = () => {
    if (playerDOMRef.current) {
      playerDOMRef.current.style.transform = `translate(${playerXRef.current}px, ${PLAYER_Y}px)`;
    }

    const container = birdsDOMEscape.current;
    if (container) {
      let html = '';
      for (let i = 0; i < birdsRef.current.length; i++) {
        const b = birdsRef.current[i];
        html += `<div style="
          position: absolute;
          left: 0;
          top: 0;
          width: ${BIRD_SIZE}px;
          height: ${BIRD_SIZE}px;
          transform: translate(${b.x}px, ${b.y}px);
          display: flex;
          justify-content: center;
          align-items: center;
        ">
          <img src="/meteor.png" alt="meteor" style="width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 8px rgba(255,60,0,0.8));" />
        </div>`;
      }
      container.innerHTML = html;
    }
  };

  return (
    <div style={styles.container}>
      <div ref={gameBoardRef} style={styles.gameBoard}>
        {/* Star Background Engine */}
        <div style={styles.starsLayer1} />
        <div style={styles.starsLayer2} />

        <div style={styles.scanlines} />

        {gameState === GAME_STATES.PLAYING && (
          <div style={styles.scoreBoard}>
            SCORE: {score.toString().padStart(4, '0')}
          </div>
        )}

        {/* DOM Escape Layer for performance */}
        <div ref={birdsDOMEscape} style={styles.birdsContainer} />

        {/* Player Object */}
        <div
          ref={playerDOMRef}
          style={{
            ...(styles.player),
            transform: `translate(${playerXRef.current}px, ${PLAYER_Y}px)`,
            display: gameState !== GAME_STATES.START ? 'flex' : 'none'
          }}
        >
          🚀
        </div>

        {gameState === GAME_STATES.START && (
          <div style={styles.overlay}>
            <div style={styles.titleContainer}>
              <h1 style={styles.title}>메테오를 피해라</h1>
              <h2 style={styles.subtitle}>이민건이 만듬</h2>
            </div>
            <div style={styles.instructionBox}>
              <p style={styles.instructions}>인계초등학교</p>
              <p style={styles.instructionKey}>만드는데 힘들었다.</p>
              <p style={styles.instructions}>10%로 완성</p>
            </div>
            <button
              style={styles.button}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onClick={resetGame}
            >
              MISSION START
            </button>
          </div>
        )}

        {gameState === GAME_STATES.GAME_OVER && (
          <div style={styles.overlay}>
            <h1 style={styles.gameOverText}>MISSION FAILED</h1>
            <div style={styles.scoreContainer}>
              <p style={styles.finalScoreLabel}>FINAL SCORE</p>
              <p style={styles.finalScoreValue}>{score}</p>
            </div>
            <button
              style={{ ...(styles.button), backgroundColor: '#ff0055', borderColor: 'transparent' }}
              onMouseEnter={(e) => Object.assign(e.currentTarget.style, { transform: 'scale(1.05)', boxShadow: '0 0 20px #ff0055' })}
              onMouseLeave={(e) => Object.assign(e.currentTarget.style, { transform: 'scale(1)', boxShadow: '0 0 10px #ff0055' })}
              onClick={resetGame}
            >
              RETRY MISSION
            </button>
          </div>
        )}

        {gameState === GAME_STATES.PLAYING && (
          <div style={styles.mobileController}>
            <div 
              ref={leftButtonRef}
              style={styles.controlButton}
              onTouchStart={(e) => { e.preventDefault(); touchDirectionRef.current = 'left'; }}
              onMouseDown={() => { touchDirectionRef.current = 'left'; }}
              onMouseUp={() => { touchDirectionRef.current = null; }}
              onMouseLeave={() => { touchDirectionRef.current = null; }}
            >
              ◀
            </div>
            <div 
              ref={rightButtonRef}
              style={styles.controlButton}
              onTouchStart={(e) => { e.preventDefault(); touchDirectionRef.current = 'right'; }}
              onMouseDown={() => { touchDirectionRef.current = 'right'; }}
              onMouseUp={() => { touchDirectionRef.current = null; }}
              onMouseLeave={() => { touchDirectionRef.current = null; }}
            >
              ▶
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#050510',
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    margin: 0,
    padding: 0,
    overflow: 'hidden',
  },
  gameBoard: {
    position: 'relative',
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#0a0a1a',
    overflow: 'hidden',
    boxShadow: '0 0 40px rgba(0, 255, 200, 0.15), inset 0 0 20px rgba(0, 0, 0, 0.8)',
    border: '2px solid #223',
    borderRadius: '12px',
    backgroundImage: 'linear-gradient(to bottom, #050510, #13132d)',
  },
  starsLayer1: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundImage: 'radial-gradient(1px 1px at 10% 20%, #ffffff, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 30% 50%, #aaaaaa, rgba(0,0,0,0)), radial-gradient(2px 2px at 60% 80%, #ffffff, rgba(0,0,0,0)), radial-gradient(1px 1px at 80% 10%, #777777, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 90% 90%, #ffffff, rgba(0,0,0,0)), radial-gradient(1px 1px at 50% 30%, #aaaaaa, rgba(0,0,0,0))',
    backgroundSize: '100% 100%',
    opacity: 0.6,
  },
  starsLayer2: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
    backgroundImage: 'radial-gradient(2px 2px at 20% 70%, #00ffff, rgba(0,0,0,0)), radial-gradient(1.5px 1.5px at 70% 40%, #ff00ff, rgba(0,0,0,0)), radial-gradient(1px 1px at 40% 90%, #ffffff, rgba(0,0,0,0))',
    backgroundSize: '150% 150%',
    opacity: 0.8,
  },
  scanlines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    background: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))',
    backgroundSize: '100% 4px, 3px 100%',
    pointerEvents: 'none',
  },
  player: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
    fontSize: '32px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    willChange: 'transform',
    filter: 'drop-shadow(0 0 10px rgba(0, 255, 255, 0.5))',
  },
  birdsContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
    zIndex: 5,
    willChange: 'contents',
  },
  scoreBoard: {
    position: 'absolute',
    top: 20,
    left: 20,
    color: '#00ffff',
    fontSize: '20px',
    fontWeight: '900',
    fontStyle: 'italic',
    zIndex: 20,
    textShadow: '0 0 10px rgba(0, 255, 255, 0.5), 2px 2px 0px rgba(0,0,0,0.8)',
    letterSpacing: '2px',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 5, 15, 0.85)',
    backdropFilter: 'blur(3px)',
    zIndex: 30,
  },
  titleContainer: {
    marginBottom: '30px',
    textAlign: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: '48px',
    margin: '0',
    fontWeight: '900',
    letterSpacing: '5px',
    textShadow: '0 0 20px rgba(0, 255, 255, 0.8), 2px 2px 0px #00ffff',
  },
  subtitle: {
    color: '#ff00ff',
    fontSize: '28px',
    margin: '-10px 0 0 0',
    fontWeight: '900',
    letterSpacing: '8px',
    textShadow: '0 0 15px rgba(255, 0, 255, 0.8)',
  },
  instructionBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    padding: '15px 25px',
    marginBottom: '30px',
    textAlign: 'center',
  },
  instructions: {
    color: '#aaa',
    fontSize: '14px',
    margin: '5px 0',
  },
  instructionKey: {
    color: '#fff',
    fontSize: '18px',
    fontWeight: 'bold',
    margin: '10px 0',
    letterSpacing: '2px',
  },
  gameOverText: {
    color: '#ff0055',
    fontSize: '42px',
    fontWeight: '900',
    marginBottom: '30px',
    textShadow: '0 0 20px rgba(255, 0, 85, 0.6), 2px 2px 0px #330011',
    letterSpacing: '2px',
  },
  scoreContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '40px',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: '20px 40px',
    borderRadius: '12px',
    border: '1px solid #334',
  },
  finalScoreLabel: {
    color: '#00ffff',
    fontSize: '16px',
    margin: '0 0 10px 0',
    letterSpacing: '3px',
  },
  finalScoreValue: {
    color: '#ffffff',
    fontSize: '56px',
    margin: 0,
    fontWeight: '900',
    textShadow: '0 0 20px rgba(0, 255, 255, 0.5)',
  },
  button: {
    padding: '16px 32px',
    fontSize: '18px',
    fontWeight: '900',
    letterSpacing: '2px',
    color: '#fff',
    backgroundColor: '#00ccff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 0 15px rgba(0, 204, 255, 0.5)',
    transition: 'all 0.2s ease-in-out',
    textTransform: 'uppercase',
  },
  mobileController: {
    position: 'fixed',
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '40px',
    zIndex: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButton: {
    width: '70px',
    height: '70px',
    backgroundColor: 'rgba(0, 204, 255, 0.3)',
    border: '2px solid #00ccff',
    borderRadius: '8px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    fontSize: '32px',
    color: '#00ccff',
    fontWeight: 'bold',
    cursor: 'pointer',
    userSelect: 'none',
    boxShadow: '0 0 10px rgba(0, 204, 255, 0.3)',
    transition: 'all 0.1s ease-in-out',
    touchAction: 'manipulation',
  },
};

