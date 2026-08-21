.PHONY: all build-stable build-canary load-stable load-canary clean

STABLE_TAG = payments-api:v2.3
CANARY_TAG = payments-api:v2.4

all: build-stable build-canary

build-stable:
	docker build -t $(STABLE_TAG) stable/

build-canary:
	docker build -t $(CANARY_TAG) canary/

load-stable: build-stable
	docker save $(STABLE_TAG) | sudo k3s ctr images import -

load-canary: build-canary
	docker save $(CANARY_TAG) | sudo k3s ctr images import -

clean:
	docker rmi $(STABLE_TAG) $(CANARY_TAG) 2>/dev/null || true