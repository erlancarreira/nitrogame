#!/usr/bin/env python3
"""
Script para corrigir nomes de arquivos otimizados
Remove o sufixo '-optimized' dos arquivos .glb e .gltf
"""

import os
import sys
from pathlib import Path
import shutil

# Configurações
ASSETS_DIR = Path("./public/assets")
BACKUP_DIR = ASSETS_DIR / "originals"

def find_optimized_files():
    """Encontra todos os arquivos com -optimized no nome"""
    optimized_files = []
    
    for ext in ['.glb', '.gltf']:
        for file_path in ASSETS_DIR.rglob(f"*-optimized{ext}"):
            # Ignorar arquivos na pasta de backup
            if BACKUP_DIR in file_path.parents or file_path.parent == BACKUP_DIR:
                continue
            optimized_files.append(file_path)
    
    return sorted(optimized_files)

def get_original_name(optimized_path: Path):
    """Retorna o nome original removendo o sufixo -optimized"""
    original_name = optimized_path.stem.replace("-optimized", "") + optimized_path.suffix
    return optimized_path.parent / original_name

def process_file(optimized_path: Path, dry_run=True):
    """
    Processa um arquivo otimizado:
    1. Se dry_run=True, apenas mostra o que seria feito
    2. Se dry_run=False, executa a operação
    """
    original_path = get_original_name(optimized_path)
    original_exists = original_path.exists()

    rel_optimized = optimized_path.relative_to(ASSETS_DIR) if ASSETS_DIR in optimized_path.parents else optimized_path.name
    rel_original = original_path.relative_to(ASSETS_DIR) if ASSETS_DIR in original_path.parents else original_path.name

    if dry_run:
        print(f"   📝 {rel_optimized}")
        print(f"      → Renomear para: {rel_original}")
        if original_exists:
            print(f"      ⚠️  Arquivo original existe e será movido para backup/")
        return True

    # Execução real
    try:
        # Criar backup do original se existir
        if original_exists:
            try:
                rel_to_assets = original_path.relative_to(ASSETS_DIR)
                backup_subdir = BACKUP_DIR / rel_to_assets.parent
                backup_subdir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_subdir / original_path.name
            except:
                backup_path = BACKUP_DIR / original_path.name
            
            # Mover original para backup
            if not backup_path.exists():
                shutil.move(str(original_path), str(backup_path))
                print(f"      📁 Original movido para backup/")
            else:
                original_path.unlink()
                print(f"      🗑️  Original removido (já existia backup)")
        
        # Renomear o otimizado para o nome original
        shutil.move(str(optimized_path), str(original_path))
        print(f"      ✅ Renomeado para: {rel_original}")
        return True
        
    except Exception as e:
        print(f"      ❌ Erro: {e}")
        return False

def main():
    print("=" * 70)
    print("🔧 Correção de Nomes - Remover Sufixo '-optimized'")
    print("=" * 70)
    print(f"📂 Diretório: {ASSETS_DIR.absolute()}")
    
    if not ASSETS_DIR.exists():
        print(f"❌ Diretório não encontrado!")
        sys.exit(1)
    
    # Encontrar arquivos
    optimized_files = find_optimized_files()
    
    if not optimized_files:
        print("\n✅ Nenhum arquivo com '-optimized' encontrado")
        print("   Tudo já está correto!")
        sys.exit(0)
    
    print(f"\n📦 Encontrados {len(optimized_files)} arquivo(s) com '-optimized':")
    print("-" * 70)
    
    # Primeiro mostrar o que será feito (dry run)
    for file_path in optimized_files:
        process_file(file_path, dry_run=True)
    
    print("\n" + "-" * 70)
    
    # Perguntar se quer executar
    try:
        resposta = input("\n⚠️  Deseja executar estas alterações? (s/n): ").strip().lower()
    except:
        print("\n💡 Para executar, rode o script normalmente (não em modo dry-run)")
        sys.exit(0)
    
    if resposta not in ['s', 'sim', 'y', 'yes']:
        print("\n❌ Operação cancelada. Nenhuma alteração foi feita.")
        sys.exit(0)
    
    # Executar
    print("\n" + "=" * 70)
    print("🚀 Executando alterações...")
    print("=" * 70)
    
    BACKUP_DIR.mkdir(exist_ok=True)
    
    success_count = 0
    failed_files = []
    
    for i, file_path in enumerate(optimized_files, 1):
        rel_path = file_path.relative_to(ASSETS_DIR) if ASSETS_DIR in file_path.parents else file_path.name
        print(f"\n[{i}/{len(optimized_files)}] 🔄 {rel_path}")
        
        if process_file(file_path, dry_run=False):
            success_count += 1
        else:
            failed_files.append(str(rel_path))
    
    # Resumo
    print("\n" + "=" * 70)
    print("📊 RESUMO")
    print("=" * 70)
    print(f"✅ Sucesso: {success_count}/{len(optimized_files)}")
    
    if failed_files:
        print(f"❌ Falhas: {len(failed_files)}")
        for f in failed_files:
            print(f"   • {f}")
    
    print(f"\n💡 Arquivos originais (se existiam) estão em: {BACKUP_DIR}")
    print(f"✅ Arquivos otimizados agora têm os nomes corretos!")
    print("=" * 70)

if __name__ == "__main__":
    main()
