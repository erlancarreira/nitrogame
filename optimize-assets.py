#!/usr/bin/env python3
"""
Otimizador de GLB/GLTF para Mario Kart Clone
Processa TODOS os arquivos e mantém o mesmo nome no arquivo otimizado
"""

import os
import subprocess
import sys
from pathlib import Path
import shutil

# Configurações
ASSETS_DIR = Path("./public/assets")
BACKUP_DIR = ASSETS_DIR / "originals"

# Extensões suportadas
SUPPORTED_EXTENSIONS = ['.glb', '.gltf']

def run_command_with_encoding(cmd, timeout=120):
    """Executa comando com tratamento de encoding para Windows"""
    try:
        creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            shell=True,
            creationflags=creationflags
        )
        
        try:
            stdout = result.stdout.decode('utf-8', errors='replace')
            stderr = result.stderr.decode('utf-8', errors='replace')
        except:
            stdout = ""
            stderr = ""
            
        return result.returncode == 0, stdout, stderr
    except subprocess.TimeoutExpired:
        return False, "", "Timeout"
    except Exception as e:
        return False, "", str(e)

def check_gltf_transform():
    """Verifica se @gltf-transform/cli está instalado"""
    try:
        success, _, _ = run_command_with_encoding(
            ["npx", "gltf-transform", "--version"], 
            timeout=10
        )
        return success
    except:
        return False

def install_gltf_transform():
    """Instala glTF Transform globalmente"""
    print("📦 Instalando @gltf-transform/cli...")
    try:
        subprocess.run(
            ["npm", "install", "-g", "@gltf-transform/cli"],
            check=True,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        print("✅ Instalação concluída!")
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro na instalação: {e}")
        print("Tente instalar manualmente: npm install -g @gltf-transform/cli")
        sys.exit(1)

def format_size(bytes_size):
    """Formata bytes para MB"""
    return f"{bytes_size / 1024 / 1024:.2f}MB"

def optimize_file(input_path: Path, output_path: Path):
    """Otimiza um único arquivo GLB/GLTF"""
    cmd = [
        "npx", "gltf-transform", "optimize",
        str(input_path),
        str(output_path),
        "--compress", "draco",
        "--texture-size", "2048",
        "--texture-compress", "webp",
        "--simplify", "error=0.001"
    ]

    success, stdout, stderr = run_command_with_encoding(cmd, timeout=120)

    if success and output_path.exists():
        original_size = input_path.stat().st_size
        new_size = output_path.stat().st_size
        reduction = (1 - new_size / original_size) * 100
        return True, reduction, original_size, new_size
    else:
        return False, 0, 0, 0

def get_relative_path(full_path: Path, base_dir: Path):
    """Retorna caminho relativo para exibição"""
    try:
        return full_path.relative_to(base_dir)
    except:
        return full_path.name

def find_files_to_process():
    """Encontra todos os arquivos .glb e .gltf para processar"""
    files_to_process = []
    
    for ext in SUPPORTED_EXTENSIONS:
        for file_path in ASSETS_DIR.rglob(f"*{ext}"):
            # Ignorar arquivos na pasta de backup
            if BACKUP_DIR in file_path.parents or file_path.parent == BACKUP_DIR:
                continue
            files_to_process.append(file_path)
    
    return sorted(files_to_process)

def process_file(file_path: Path):
    """
    Processa um arquivo mantendo o mesmo nome no final:
    1. Otimiza para arquivo temporário
    2. Move original para backup
    3. Renomeia otimizado para nome original
    """
    ext = file_path.suffix
    temp_name = file_path.stem + "-temp-optimized" + ext
    temp_path = file_path.parent / temp_name
    
    # Passo 1: Otimizar para arquivo temporário
    success, reduction, orig_size, new_size = optimize_file(file_path, temp_path)
    
    if not success:
        if temp_path.exists():
            temp_path.unlink()
        return False, 0, 0, 0
    
    # Passo 2: Calcular caminho de backup preservando estrutura
    try:
        rel_to_assets = file_path.relative_to(ASSETS_DIR)
        backup_subdir = BACKUP_DIR / rel_to_assets.parent
        backup_subdir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_subdir / file_path.name
    except:
        backup_path = BACKUP_DIR / file_path.name
    
    # Passo 3: Mover original para backup (se ainda não existe)
    if not backup_path.exists():
        shutil.move(str(file_path), str(backup_path))
    else:
        # Se já existe backup, sobrescreve o original
        file_path.unlink()
    
    # Passo 4: Renomear temporário para nome original
    shutil.move(str(temp_path), str(file_path))
    
    return True, reduction, orig_size, new_size

def main():
    print("=" * 70)
    print("🎮 Otimizador de Assets - Mario Kart Clone")
    print("=" * 70)
    print(f"📂 Diretório base: {ASSETS_DIR.absolute()}")

    if not ASSETS_DIR.exists():
        print(f"❌ Diretório não encontrado!")
        sys.exit(1)

    BACKUP_DIR.mkdir(exist_ok=True)

    if not check_gltf_transform():
        install_gltf_transform()

    # Encontrar todos os arquivos
    files_to_process = find_files_to_process()

    if not files_to_process:
        print("\n⚠️  Nenhum arquivo .glb ou .gltf para processar")
        sys.exit(0)

    print(f"\n📦 Encontrados {len(files_to_process)} arquivo(s) para otimizar")
    print("   ⚠️  Os arquivos manterão o mesmo nome! Originais vão para 'originals/'")
    print("-" * 70)

    total_original = 0
    total_optimized = 0
    success_count = 0
    failed_files = []

    for i, file_path in enumerate(files_to_process, 1):
        rel_path = get_relative_path(file_path, ASSETS_DIR)
        print(f"\n[{i}/{len(files_to_process)}] 🔄 {rel_path}")

        success, reduction, orig_size, new_size = process_file(file_path)

        if success:
            success_count += 1
            total_original += orig_size
            total_optimized += new_size
            print(f"   ✅ {format_size(orig_size)} → {format_size(new_size)} (-{reduction:.1f}%)")
        else:
            failed_files.append(str(rel_path))
            print(f"   ❌ Falha na otimização")

    print("\n" + "=" * 70)
    print("📊 RESUMO")
    print("=" * 70)
    print(f"✅ Sucesso: {success_count}/{len(files_to_process)}")

    if failed_files:
        print(f"❌ Falhas: {len(failed_files)}")
        for f in failed_files:
            print(f"   • {f}")

    if total_original > 0:
        total_reduction = (1 - total_optimized / total_original) * 100
        print(f"\n📈 Economia total:")
        print(f"   Original:  {format_size(total_original)}")
        print(f"   Otimizado: {format_size(total_optimized)}")
        print(f"   Redução:   {total_reduction:.1f}%")

    print(f"\n💡 Originais salvos em: {BACKUP_DIR}")
    print(f"💡 Arquivos otimizados mantêm os nomes originais!")
    print("=" * 70)

if __name__ == "__main__":
    main()
