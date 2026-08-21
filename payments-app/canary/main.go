package main

import (
	"expvar"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"sync/atomic"
	"time"
)

// Same Prometheus metrics as stable
var (
	httpRequestsTotal  = expvar.NewMap("http_requests_total")
	httpDurationBucket = expvar.NewMap("http_request_duration_seconds_bucket")
	heapAllocMB       = expvar.NewFloat("process_heap_alloc_mb")
	memoryLeakMB      = expvar.NewFloat("memory_leak_mb")
)

var requestCounter uint64

// startMemoryLeak allocates memory in a background goroutine.
// With a 256Mi limit and ~10MB/5s allocation rate, OOMKilled occurs in ~2 minutes.
// With a 128Mi limit, OOMKilled occurs in ~1 minute.
func startMemoryLeak() {
	var leaked [][]byte
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		// Allocate 10MB chunk — write to prevent compiler optimization
		chunk := make([]byte, 10*1024*1024)
		for i := range chunk {
			chunk[i] = byte(i % 256)
		}
		leaked = append(leaked, chunk)
		memoryLeakMB.Set(float64(len(leaked)*10) / 1.0)
		log.Printf("[LEAK] allocated %d chunks (%d MB total)", len(leaked), len(leaked)*10)
	}
}

// startErrorRateRamp gradually increases the error rate over time.
// After 30s: ~15% error rate. After 60s: ~50% error rate.
func startErrorRateRamp() {
	startTime := time.Now()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		elapsed := time.Since(startTime).Seconds()
		// Ramp from 0% to 50% over 90 seconds
		rate := min(0.50, elapsed/180.0)
		atomic.StoreInt64(&currentErrorRate, int64(rate*10000))
		log.Printf("[RAMP] error rate set to %.2f%%", rate*100)
	}
}

var currentErrorRate int64 // stored as basis points (10000 = 100%)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	version := os.Getenv("VERSION")
	if version == "" {
		version = "v2.4"
	}

	rand.Seed(time.Now().UnixNano())

	// Start the memory leak — this causes the REAL OOMKilled
	go startMemoryLeak()

	// Start error rate ramp — simulates degraded performance from memory pressure
	go startErrorRateRamp()

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		// Health check fails once memory leak is large enough
		leakedMB := memoryLeakMB.Value()
		if leakedMB > 200 {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte("unhealthy: memory pressure"))
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	http.HandleFunc("/api/payments", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		n := atomic.AddUint64(&requestCounter, 1)

		// Use the ramping error rate
		rate := float64(atomic.LoadInt64(&currentErrorRate)) / 10000.0
		if rand.Float64() < rate {
			httpRequestsTotal.Add("code=5xx", 1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(fmt.Sprintf(`{"status":"error","version":"%s","error":"memory pressure"}`, version)))
		} else {
			httpRequestsTotal.Add("code=2xx", 1)
			w.Header().Set("Content-Type", "application/json")
			// Simulate higher latency under memory pressure
			leakedMB := memoryLeakMB.Value()
			if leakedMB > 100 {
				time.Sleep(time.Duration(rand.Intn(500)) * time.Millisecond)
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(fmt.Sprintf(`{"status":"ok","version":"%s","request_id":%d}`, version, n)))
		}

		dur := time.Since(start).Seconds()
		httpDurationBucket.Add("le=0.05", 1)
		if dur > 0.05 {
			httpDurationBucket.Add("le=0.1", 1)
		}
		if dur > 0.1 {
			httpDurationBucket.Add("le=0.5", 1)
		}
		if dur > 0.5 {
			httpDurationBucket.Add("le=1.0", 1)
		}
		if dur > 1.0 {
			httpDurationBucket.Add("le=2.0", 1)
		}
		if dur > 2.0 {
			httpDurationBucket.Add("le=5.0", 1)
		}
		if dur > 5.0 {
			httpDurationBucket.Add("le=+Inf", 1)
		}
	})

	http.Handle("/metrics", expvar.Handler())

	log.Printf("payments-api %s starting on :%s (WITH MEMORY LEAK)", version, port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}

func init() {
	go func() {
		for {
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			heapAllocMB.Set(float64(m.Alloc) / 1024.0 / 1024.0)
			time.Sleep(2 * time.Second)
		}
	}()
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}