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


def run_experiment(noise, n_seeds=10):
    """Run both architectures across multiple seeds at a given noise level."""
    std_accs, bin_accs = [], []
    std_losses, bin_losses = [], []
    std_times, bin_times = [], []

    for seed in range(n_seeds):
        torch.manual_seed(seed)
        np.random.seed(seed)
        X_tr, y_tr, X_te, y_te = make_data(n_samples=1000, noise=noise)

        r_std = run_trial("Standard", StandardMLP, X_tr, y_tr, X_te, y_te)
        r_bin = run_trial("Binomial", BinomialMLP, X_tr, y_tr, X_te, y_te)

        std_accs.append(r_std["accuracy"])
        bin_accs.append(r_bin["accuracy"])
        std_losses.append(r_std["final_loss"])
        bin_losses.append(r_bin["final_loss"])
        std_times.append(r_std["train_time"])
        bin_times.append(r_bin["train_time"])

    return {
        "noise": noise,
        "std_acc_mean": np.mean(std_accs),
        "std_acc_std": np.std(std_accs),
        "bin_acc_mean": np.mean(bin_accs),
        "bin_acc_std": np.std(bin_accs),
        "std_loss_mean": np.mean(std_losses),
        "bin_loss_mean": np.mean(bin_losses),
        "std_time_mean": np.mean(std_times),
        "bin_time_mean": np.mean(bin_times),
    }


def main():
    print("=" * 60)
    print("  BINOMIAL NEURAL ARCHITECTURE — Comparative Test")
    print("=" * 60)

    noise_levels = [0.05, 0.15, 0.25, 0.35, 0.45]

    all_results = []
    for noise in noise_levels:
        print(f"\n--- Noise: {noise} ---")
        r = run_experiment(noise, n_seeds=10)
        all_results.append(r)
        print(f"  Standard: acc={r['std_acc_mean']:.4f}+/-{r['std_acc_std']:.4f}  "
              f"loss={r['std_loss_mean']:.4f}  time={r['std_time_mean']:.3f}s")
        print(f"  Binomial: acc={r['bin_acc_mean']:.4f}+/-{r['bin_acc_std']:.4f}  "
              f"loss={r['bin_loss_mean']:.4f}  time={r['bin_time_mean']:.3f}s")

    # ── Summary table ──
    print("\n" + "=" * 70)
    print(f"{'Noise':<8} {'Std Acc':>10} {'Bin Acc':>10} {'Delta':>8} {'Std P':>7} {'Bin P':>7}")
    print("-" * 70)
    for r in all_results:
        delta = (r["bin_acc_mean"] - r["std_acc_mean"]) * 100
        print(f"{r['noise']:<8.2f} {r['std_acc_mean']:>9.4f} {r['bin_acc_mean']:>9.4f} "
              f"{delta:>+7.2f}% {'151':>7} {'75':>7}")
    print()

    # ── Verdict ──
    wins = sum(1 for r in all_results if r["bin_acc_mean"] > r["std_acc_mean"])
    ties = sum(1 for r in all_results if abs(r["bin_acc_mean"] - r["std_acc_mean"]) < 0.001)
    losses = len(all_results) - wins - ties
    print(f"=> Binomial won {wins}/{len(all_results)} noise levels, "
          f"tied {ties}, lost {losses}.")
    print(f"=> Binomial uses 50% fewer parameters (75 vs 151).")
    print()


if __name__ == "__main__":
    main()
