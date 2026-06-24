use std::sync::atomic::{AtomicUsize, Ordering};

/// Lock-free single-producer, single-consumer ring buffer for zero-copy
/// transaction passing between pipeline stages.
///
/// Capacity must be a power of 2 for bit-masking instead of modulo.
pub struct RingBuffer<T> {
    buffer: Vec<Option<T>>,
    capacity: usize,
    mask: usize,
    head: AtomicUsize, // write position (producer)
    tail: AtomicUsize, // read position (consumer)
}

impl<T: Clone> RingBuffer<T> {
    /// Create a ring buffer with given capacity (rounded up to next power of 2).
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.next_power_of_two();
        let mut buffer = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffer.push(None);
        }
        Self {
            buffer,
            capacity,
            mask: capacity - 1,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    /// Try to push an item. Returns Err(item) if full.
    pub fn try_push(&mut self, item: T) -> Result<(), T> {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        let next_head = (head + 1) & self.mask;

        if next_head == tail {
            return Err(item); // full
        }

        self.buffer[head] = Some(item);
        self.head.store(next_head, Ordering::Release);
        Ok(())
    }

    /// Try to pop an item. Returns None if empty.
    pub fn try_pop(&mut self) -> Option<T> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);

        if tail == head {
            return None; // empty
        }

        let item = self.buffer[tail].take();
        self.tail.store((tail + 1) & self.mask, Ordering::Release);
        item
    }

    /// Returns current occupancy.
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Relaxed);
        (head.wrapping_sub(tail)) & self.mask
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn capacity(&self) -> usize {
        self.capacity - 1 // one slot reserved for full/empty disambiguation
    }

    pub fn is_full(&self) -> bool {
        self.len() == self.capacity()
    }
}

/// Multi-stage pipeline connecting ring buffers for zero-copy processing.
pub struct PipelineStage<T: Clone> {
    name: String,
    input: RingBuffer<T>,
    output: RingBuffer<T>,
    processed: usize,
    dropped: usize,
}

impl<T: Clone> PipelineStage<T> {
    pub fn new(name: &str, buffer_size: usize) -> Self {
        Self {
            name: name.to_string(),
            input: RingBuffer::new(buffer_size),
            output: RingBuffer::new(buffer_size),
            processed: 0,
            dropped: 0,
        }
    }

    /// Feed an item into the input buffer.
    pub fn feed(&mut self, item: T) -> Result<(), T> {
        self.input.try_push(item)
    }

    /// Process all available items using the given transform function.
    pub fn process<F>(&mut self, transform: F) -> usize
    where
        F: Fn(&T) -> Option<T>,
    {
        let mut count = 0;
        while let Some(item) = self.input.try_pop() {
            if let Some(result) = transform(&item) {
                if self.output.try_push(result).is_ok() {
                    count += 1;
                    self.processed += 1;
                } else {
                    self.dropped += 1;
                }
            } else {
                self.dropped += 1;
            }
        }
        count
    }

    /// Drain all items from the output buffer.
    pub fn drain_output(&mut self) -> Vec<T> {
        let mut results = Vec::new();
        while let Some(item) = self.output.try_pop() {
            results.push(item);
        }
        results
    }

    pub fn stats(&self) -> (usize, usize) {
        (self.processed, self.dropped)
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_basic() {
        let mut rb: RingBuffer<u64> = RingBuffer::new(4);
        assert_eq!(rb.capacity(), 3); // 4-1 for disambiguation

        assert!(rb.try_push(1).is_ok());
        assert!(rb.try_push(2).is_ok());
        assert!(rb.try_push(3).is_ok());
        assert!(rb.try_push(4).is_err()); // full

        assert_eq!(rb.try_pop(), Some(1));
        assert_eq!(rb.try_pop(), Some(2));
        assert_eq!(rb.try_pop(), Some(3));
        assert_eq!(rb.try_pop(), None); // empty
    }

    #[test]
    fn test_ring_buffer_power_of_two() {
        let rb: RingBuffer<u32> = RingBuffer::new(5);
        // should round up to 8
        assert_eq!(rb.capacity(), 7);
    }

    #[test]
    fn test_ring_buffer_wrap_around() {
        let mut rb: RingBuffer<u32> = RingBuffer::new(4);

        // Fill and drain multiple times to test wrap-around
        for cycle in 0..10 {
            let base = cycle * 3;
            assert!(rb.try_push(base).is_ok());
            assert!(rb.try_push(base + 1).is_ok());
            assert!(rb.try_push(base + 2).is_ok());

            assert_eq!(rb.try_pop(), Some(base));
            assert_eq!(rb.try_pop(), Some(base + 1));
            assert_eq!(rb.try_pop(), Some(base + 2));
        }
    }

    #[test]
    fn test_ring_buffer_len() {
        let mut rb: RingBuffer<u32> = RingBuffer::new(8);
        assert_eq!(rb.len(), 0);
        assert!(rb.is_empty());

        rb.try_push(1).unwrap();
        rb.try_push(2).unwrap();
        assert_eq!(rb.len(), 2);

        rb.try_pop();
        assert_eq!(rb.len(), 1);
    }

    #[test]
    fn test_pipeline_stage() {
        let mut stage: PipelineStage<u64> = PipelineStage::new("double", 16);

        for i in 1..=5 {
            stage.feed(i).unwrap();
        }

        let processed = stage.process(|&x| {
            if x > 0 {
                Some(x * 2)
            } else {
                None
            }
        });
        assert_eq!(processed, 5);

        let output = stage.drain_output();
        assert_eq!(output, vec![2, 4, 6, 8, 10]);
    }

    #[test]
    fn test_pipeline_stage_filtering() {
        let mut stage: PipelineStage<u64> = PipelineStage::new("filter", 16);

        for i in 1..=10 {
            stage.feed(i).unwrap();
        }

        // Only pass even numbers
        let processed = stage.process(|&x| if x % 2 == 0 { Some(x) } else { None });
        assert_eq!(processed, 5);

        let (p, d) = stage.stats();
        assert_eq!(p, 5); // 5 even numbers passed
        assert_eq!(d, 5); // 5 odd numbers dropped
    }
}
