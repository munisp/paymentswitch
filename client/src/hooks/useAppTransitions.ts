/**
 * Native-like page transitions and gesture navigation for PWA.
 * Provides iOS/Android-style animations, swipe-back, and pull-to-refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface TransitionState {
  isTransitioning: boolean;
  direction: 'forward' | 'back' | 'none';
  progress: number;
}

interface GestureState {
  isSwipingBack: boolean;
  swipeProgress: number;
  isPullingToRefresh: boolean;
  pullProgress: number;
}

export function useAppTransitions() {
  const [transition, setTransition] = useState<TransitionState>({
    isTransitioning: false,
    direction: 'none',
    progress: 0,
  });

  const [gesture, setGesture] = useState<GestureState>({
    isSwipingBack: false,
    swipeProgress: 0,
    isPullingToRefresh: false,
    pullProgress: 0,
  });

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const scrollTopRef = useRef(0);

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
      scrollTopRef.current = document.documentElement.scrollTop || document.body.scrollTop;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;

      // Swipe-back gesture (from left edge, horizontal > vertical)
      if (touchStartRef.current.x < 30 && dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        const progress = Math.min(dx / window.innerWidth, 1);
        setGesture(g => ({ ...g, isSwipingBack: true, swipeProgress: progress }));
        e.preventDefault();
      }

      // Pull-to-refresh (at top of page, pulling down)
      if (scrollTopRef.current <= 0 && dy > 0 && Math.abs(dy) > Math.abs(dx) * 2) {
        const progress = Math.min(dy / 150, 1);
        setGesture(g => ({ ...g, isPullingToRefresh: true, pullProgress: progress }));
      }
    };

    const handleTouchEnd = () => {
      if (gesture.isSwipingBack && gesture.swipeProgress > 0.4) {
        window.history.back();
      }
      if (gesture.isPullingToRefresh && gesture.pullProgress >= 1) {
        window.location.reload();
      }
      setGesture({ isSwipingBack: false, swipeProgress: 0, isPullingToRefresh: false, pullProgress: 0 });
      touchStartRef.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gesture.isSwipingBack, gesture.swipeProgress, gesture.isPullingToRefresh, gesture.pullProgress]);

  // Trigger page transition animation
  const navigate = useCallback((direction: 'forward' | 'back') => {
    setTransition({ isTransitioning: true, direction, progress: 0 });

    // Animate over 300ms
    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / 300, 1);
      setTransition(t => ({ ...t, progress }));
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setTimeout(() => {
          setTransition({ isTransitioning: false, direction: 'none', progress: 0 });
        }, 50);
      }
    };
    requestAnimationFrame(animate);
  }, []);

  // CSS classes for transition states
  const getTransitionStyle = useCallback((): React.CSSProperties => {
    if (!transition.isTransitioning) return {};
    const translate = transition.direction === 'forward'
      ? `translateX(${(1 - transition.progress) * 100}%)`
      : `translateX(${(transition.progress - 1) * 30}%)`;
    return {
      transform: translate,
      opacity: transition.direction === 'back' ? 0.5 + transition.progress * 0.5 : 1,
      transition: 'none',
    };
  }, [transition]);

  const getSwipeBackStyle = useCallback((): React.CSSProperties => {
    if (!gesture.isSwipingBack) return {};
    return {
      transform: `translateX(${gesture.swipeProgress * 100}%)`,
      boxShadow: `-5px 0 20px rgba(0,0,0,${0.1 * (1 - gesture.swipeProgress)})`,
      transition: 'none',
    };
  }, [gesture.isSwipingBack, gesture.swipeProgress]);

  return {
    transition,
    gesture,
    navigate,
    getTransitionStyle,
    getSwipeBackStyle,
  };
}
