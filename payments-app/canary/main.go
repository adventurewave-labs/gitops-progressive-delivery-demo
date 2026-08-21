package main

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// -----------------------------------------------------------------------------
// Prometheus metrics, text exposition format (no external deps).
// Identical exposition to the stable build so the AnalysisTemplate can compare
// the canary Service against the same series names.
// -----------------------------------------------------------------------------

var durationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type metrics struct {
	mu           sync.Mutex
	requests     map[string]uint64
	bucketCounts []uint64
	durSum       float64
	durCount     uint64
}

func newMetrics() *metrics {
	return &metrics{
		requests:     map[string]uint64{"200": 0, "500": 0},
		bucketCounts: make([]uint64, len(durationBuckets)),
	}
}

func (m *metrics) observe(code int, seconds float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests[strconv.Itoa(code)]++
	m.durSum += seconds
	m.durCount++
	for i, b := range durationBuckets {
		if seconds <= b {
			m.bucketCounts[i]++
			return
		}
	}
}

func (m *metrics) writeTo(w http.ResponseWriter, version string, heapMB, leakMB float64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests handled, by status code.\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	for _, code := range []string{"200", "500"} {
		fmt.Fprintf(w, "http_requests_total{code=\"%s\"} %d\n", code, m.requests[code])
	}

	fmt.Fprintf(w, "# HELP http_request_duration_seconds Request latency.\n")
	fmt.Fprintf(w, "# TYPE http_request_duration_seconds histogram\n")
	var cumulative uint64
	for i, b := range durationBuckets {
		cumulative += m.bucketCounts[i]
		fmt.Fprintf(w, "http_request_duration_seconds_bucket{le=\"%g\"} %d\n", b, cumulative)
	}
	fmt.Fprintf(w, "http_request_duration_seconds_bucket{le=\"+Inf\"} %d\n", m.durCount)
	fmt.Fprintf(w, "http_request_duration_seconds_sum %g\n", m.durSum)
	fmt.Fprintf(w, "http_request_duration_seconds_count %d\n", m.durCount)

	fmt.Fprintf(w, "# HELP process_heap_alloc_mb Go heap currently allocated, in MiB.\n")
	fmt.Fprintf(w, "# TYPE process_heap_alloc_mb gauge\n")
	fmt.Fprintf(w, "process_heap_alloc_mb %g\n", heapMB)

	fmt.Fprintf(w, "# HELP memory_leak_mb Memory deliberately leaked by this build, in MiB.\n")
	fmt.Fprintf(w, "# TYPE memory_leak_mb gauge\n")
	fmt.Fprintf(w, "memory_leak_mb %g\n", leakMB)

	fmt.Fprintf(w, "# HELP payments_api_info Build info.\n")
	fmt.Fprintf(w, "# TYPE payments_api_info gauge\n")
	fmt.Fprintf(w, "payments_api_info{version=\"%s\"} 1\n", version)
}

var (
	mets             = newMetrics()
	requestCounter   uint64
	leakedMB         atomic.Int64
	currentErrorRate atomic.Int64 // basis points; 10000 = 100%
)

func heapMB() float64 {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.Alloc) / 1024.0 / 1024.0
}

// startMemoryLeak allocates 10MB every 5s and never frees it.
// The Rollout sets a 128Mi container limit, so the kernel OOMKills this
// container after roughly a minute. This is the real failure the demo shows.
func startMemoryLeak() {
	var leaked [][]byte
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		chunk := make([]byte, 10*1024*1024)
		for i := range chunk {
			chunk[i] = byte(i % 256) // write, so the allocation is real
		}
		leaked = append(leaked, chunk)
		leakedMB.Store(int64(len(leaked) * 10))
		log.Printf("[LEAK] allocated %d chunks (%d MB total)", len(leaked), len(leaked)*10)
	}
}

// startErrorRateRamp ramps the 5xx rate from 0% to 50% over 180s, so the
// canary's error-rate SLO is genuinely breached while it is still alive.
func startErrorRateRamp() {
	startTime := time.Now()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		elapsed := time.Since(startTime).Seconds()
		rate := elapsed / 180.0
		if rate > 0.50 {
			rate = 0.50
		}
		currentErrorRate.Store(int64(rate * 10000))
		log.Printf("[RAMP] error rate set to %.2f%%", rate*100)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	version := os.Getenv("VERSION")
	if version == "" {
		version = "v2.4"
	}

	go startMemoryLeak()
	go startErrorRateRamp()

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		// Stay "healthy" for the kubelet: we want the kernel OOMKill to be the
		// thing that kills this container, not a liveness restart that would
		// reset the leak before the limit is reached.
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	http.HandleFunc("/api/payments", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		n := atomic.AddUint64(&requestCounter, 1)

		rate := float64(currentErrorRate.Load()) / 10000.0
		if rand.Float64() < rate {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprintf(w, `{"status":"error","version":"%s","error":"memory pressure"}`, version)
			mets.observe(http.StatusInternalServerError, time.Since(start).Seconds())
			return
		}

		// Latency degrades as the leak grows.
		if leakedMB.Load() > 60 {
			time.Sleep(time.Duration(rand.Intn(600)) * time.Millisecond)
		} else {
			time.Sleep(time.Duration(rand.Intn(15)) * time.Millisecond)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"ok","version":"%s","request_id":%d}`, version, n)

		mets.observe(http.StatusOK, time.Since(start).Seconds())
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		mets.writeTo(w, version, heapMB(), float64(leakedMB.Load()))
	})

	log.Printf("payments-api %s starting on :%s (WITH MEMORY LEAK)", version, port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
