"""
Binomial Neural Architecture vs Standard Architecture — Comparative Test

Compares:
  Standard:  2 → 10 → 10 → 1  (30 total neurons)
  Binomial:  2 → 4 → 6 → 4 → 1 (15 total neurons, half the size)

Task: Non-linear classification on concentric circles (moons dataset).
"""

import time
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.datasets import make_moons
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import numpy as np


# ── Models ──────────────────────────────────────────────────────────────────

class StandardMLP(nn.Module):
    """Standard rectangular MLP: 2 → 10 → 10 → 1"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(2, 10),
            nn.ReLU(),
            nn.Linear(10, 10),
            nn.ReLU(),
            nn.Linear(10, 1),
        )

    def forward(self, x):
        return self.net(x)


class BinomialMLP(nn.Module):
    """Binomial envelope MLP: 2 → 4 → 6 → 4 → 1"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(2, 4),
            nn.ReLU(),
            nn.Linear(4, 6),
            nn.ReLU(),
            nn.Linear(6, 4),
            nn.ReLU(),
            nn.Linear(4, 1),
        )

    def forward(self, x):
        return self.net(x)


# ── Data ────────────────────────────────────────────────────────────────────

def make_data(n_samples=1000, noise=0.15, test_size=0.2):
    X, y = make_moons(n_samples=n_samples, noise=noise, random_state=42)
    X = StandardScaler().fit_transform(X)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=42
    )
    return (
        torch.tensor(X_train, dtype=torch.float32),
        torch.tensor(y_train, dtype=torch.float32).unsqueeze(1),
        torch.tensor(X_test, dtype=torch.float32),
        torch.tensor(y_test, dtype=torch.float32).unsqueeze(1),
    )


# ── Training ────────────────────────────────────────────────────────────────

def train(model, X_train, y_train, epochs=500, lr=0.01):
    optimizer = optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCEWithLogitsLoss()

    history = []
    t0 = time.time()
    for _ in range(epochs):
        model.train()
        pred = model(X_train)
        loss = criterion(pred, y_train)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        history.append(loss.item())
    elapsed = time.time() - t0
    return history, elapsed


def evaluate(model, X_test, y_test):
    model.eval()
    with torch.no_grad():
        pred = model(X_test)
        acc = ((pred > 0).float() == y_test).float().mean().item()
    return acc


# ── Run ─────────────────────────────────────────────────────────────────────

def run_trial(name, model_cls, X_train, y_train, X_test, y_test):
    torch.manual_seed(42)
    model = model_cls()
    total_params = sum(p.numel() for p in model.parameters())

    history, elapsed = train(model, X_train, y_train)
    acc = evaluate(model, X_test, y_test)

    return {
        "name": name,
        "params": total_params,
        "accuracy": acc,
        "train_time": elapsed,
        "final_loss": history[-1],
        "loss_curve": history,
    }


def main():
    print("=" * 60)
    print("  BINOMIAL NEURAL ARCHITECTURE — Comparative Test")
    print("=" * 60)

    X_train, y_train, X_test, y_test = make_data(
        n_samples=1000, noise=0.15
    )

    results = [
        run_trial("Standard (2→10→10→1)", StandardMLP, X_train, y_train, X_test, y_test),
        run_trial("Binomial (2→4→6→4→1)", BinomialMLP, X_train, y_train, X_test, y_test),
    ]

    # ── Results table ──
    print(f"\n{'Metric':<20} {'Standard':>12} {'Binomial':>12}")
    print("-" * 46)
    for r in results:
        print(f"{'Parameters':<20} {r['params']:>12} {r['params']:>12}")
    print(f"{'Parameters':<20} {results[0]['params']:>12} {results[1]['params']:>12}")
    print(f"{'Test Accuracy':<20} {results[0]['accuracy']:>11.4f} {results[1]['accuracy']:>11.4f}")
    print(f"{'Final Loss':<20} {results[0]['final_loss']:>11.4f} {results[1]['final_loss']:>11.4f}")
    print(f"{'Train Time (s)':<20} {results[0]['train_time']:>11.3f} {results[1]['train_time']:>11.3f}")
    print()

    # ── Verdict ──
    if results[1]["accuracy"] > results[0]["accuracy"]:
        print("→ Binomial architecture won on accuracy.")
    elif results[0]["accuracy"] > results[1]["accuracy"]:
        print("→ Standard architecture won on accuracy.")
    else:
        print("→ Tied on accuracy.")

    param_ratio = results[0]["params"] / results[1]["params"]
    print(f"→ Binomial used {param_ratio:.1f}x fewer parameters for "
          f"{(results[1]['accuracy'] - results[0]['accuracy'])*100:+.2f}% accuracy delta.")
    print()


if __name__ == "__main__":
    main()
