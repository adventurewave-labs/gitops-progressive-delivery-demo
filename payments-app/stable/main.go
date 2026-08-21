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

// Prometheus-compatible metrics via expvar
var (
	httpRequestsTotal  = expvar.NewMap("http_requests_total")
	httpDurationBucket = expvar.NewMap("http_request_duration_seconds_bucket")
	heapAllocMB       = expvar.NewFloat("process_heap_alloc_mb")
)

var requestCounter uint64

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	version := os.Getenv("VERSION")
	if version == "" {
		version = "v2.3"
	}

	rand.Seed(time.Now().UnixNano())

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	http.HandleFunc("/api/payments", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		n := atomic.AddUint64(&requestCounter, 1)

		// v2.3: 0.1% error rate (baseline healthy)
		if rand.Float64() < 0.001 {
			httpRequestsTotal.Add("code=5xx", 1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(fmt.Sprintf(`{"status":"error","version":"%s"}`, version)))
		} else {
			httpRequestsTotal.Add("code=2xx", 1)
			w.Header().Set("Content-Type", "application/json")
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

	// /metrics endpoint — Prometheus exposition format via expvar
	http.Handle("/metrics", expvar.Handler())

	log.Printf("payments-api %s starting on :%s", version, port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}

// Report heap usage every 2s for Prometheus
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
