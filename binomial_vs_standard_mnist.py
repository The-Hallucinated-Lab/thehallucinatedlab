"""
Binomial Neural Architecture vs Standard — MNIST Test

Standard:  784 → 256 → 128 → 10   (rectangular)
Binomial:  784 → 64 → 128 → 64 → 10 (expansion-compression)
"""

import time
import torch
import torch.nn as nn
import torch.optim as optim
from torchvision import datasets, transforms
from torch.utils.data import DataLoader
import numpy as np


# ── Models ──────────────────────────────────────────────────────────────────

class StandardMLP(nn.Module):
    """Standard: 784 → 256 → 128 → 10"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(784, 256),
            nn.ReLU(),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, 10),
        )

    def forward(self, x):
        return self.net(x.view(x.size(0), -1))


class BinomialMLP(nn.Module):
    """Binomial envelope: 784 → 64 → 128 → 64 → 10"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(784, 64),
            nn.ReLU(),
            nn.Linear(64, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 10),
        )

    def forward(self, x):
        return self.net(x.view(x.size(0), -1))


class BinomialWideMLP(nn.Module):
    """Wide binomial: 784 → 128 → 256 → 128 → 10 (matched params to standard)"""

    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(784, 128),
            nn.ReLU(),
            nn.Linear(128, 256),
            nn.ReLU(),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Linear(128, 10),
        )

    def forward(self, x):
        return self.net(x.view(x.size(0), -1))


# ── Data ────────────────────────────────────────────────────────────────────

def get_loaders(batch_size=256):
    transform = transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize((0.1307,), (0.3081,)),
    ])
    train_ds = datasets.MNIST("data", train=True, download=True, transform=transform)
    test_ds = datasets.MNIST("data", train=False, transform=transform)
    return (
        DataLoader(train_ds, batch_size=batch_size, shuffle=True),
        DataLoader(test_ds, batch_size=512),
    )


# ── Train / Eval ────────────────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, criterion):
    model.train()
    total_loss, correct, total = 0, 0, 0
    for X, y in loader:
        optimizer.zero_grad()
        logits = model(X)
        loss = criterion(logits, y)
        loss.backward()
        optimizer.step()
        total_loss += loss.item() * X.size(0)
        correct += (logits.argmax(1) == y).sum().item()
        total += X.size(0)
    return total_loss / total, correct / total


@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    correct, total = 0, 0
    for X, y in loader:
        logits = model(X)
        correct += (logits.argmax(1) == y).sum().item()
        total += X.size(0)
    return correct / total


# ── Run ─────────────────────────────────────────────────────────────────────

def run(name, model_cls, train_loader, test_loader, epochs=10, lr=0.001):
    torch.manual_seed(42)
    model = model_cls()
    params = sum(p.numel() for p in model.parameters())
    optimizer = optim.Adam(model.parameters(), lr=lr)
    criterion = nn.CrossEntropyLoss()

    print(f"\n  {name} ({params:,} params)")
    print(f"  {'Epoch':<8} {'Train Loss':>10} {'Train Acc':>10} {'Test Acc':>10} {'Time':>8}")
    print(f"  {'-'*50}")

    t0 = time.time()
    for epoch in range(1, epochs + 1):
        t_epoch = time.time()
        loss, train_acc = train_epoch(model, train_loader, optimizer, criterion)
        test_acc = evaluate(model, test_loader)
        elapsed = time.time() - t_epoch
        print(f"  {epoch:<8} {loss:>10.4f} {train_acc:>9.2%} {test_acc:>9.2%} {elapsed:>7.2f}s")
    total_time = time.time() - t0

    return {"name": name, "params": params, "test_acc": test_acc, "time": total_time}


def main():
    print("=" * 65)
    print("  BINOMIAL NEURAL ARCHITECTURE — MNIST Comparative Test")
    print("=" * 65)

    train_loader, test_loader = get_loaders()

    results = [
        run("Standard  (784->256->128->10)", StandardMLP, train_loader, test_loader),
        run("Binomial   (784->64->128->64->10)", BinomialMLP, train_loader, test_loader),
        run("BinomialW  (784->128->256->128->10)", BinomialWideMLP, train_loader, test_loader),
    ]

    print("\n" + "=" * 65)
    print(f"  {'Model':<30} {'Params':>10} {'Test Acc':>10} {'Time':>8}")
    print(f"  {'-'*62}")
    for r in results:
        print(f"  {r['name']:<30} {r['params']:>10,} {r['test_acc']:>9.2%} {r['time']:>7.1f}s")
    print()

    # Verdict
    best = max(results, key=lambda r: r["test_acc"])
    print(f"  Best: {best['name']} at {best['test_acc']:.2%}")

    std_r = results[0]
    bin_r = results[1]
    binw_r = results[2]
    print(f"  Binomial (small) vs Standard: {(bin_r['test_acc']-std_r['test_acc'])*100:+.2f}% acc, "
          f"{std_r['params']/bin_r['params']:.1f}x fewer params")
    print(f"  Binomial (wide) vs Standard:  {(binw_r['test_acc']-std_r['test_acc'])*100:+.2f}% acc, "
          f"{std_r['params']/binw_r['params']:.1f}x fewer params")
    print()


if __name__ == "__main__":
    main()
