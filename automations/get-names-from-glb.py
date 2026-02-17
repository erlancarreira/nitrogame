import os
import json


def pedir_pasta():
    while True:
        pasta = input("Digite o CAMINHO COMPLETO da pasta com arquivos .glb:\n> ").strip().strip('"')

        if not pasta:
            print("⚠ Você precisa digitar um caminho.\n")
            continue

        if not os.path.isabs(pasta):
            print("⚠ Informe o caminho COMPLETO (absoluto), não relativo.\n")
            continue

        if not os.path.isdir(pasta):
            print("⚠ Pasta não encontrada. Tente novamente.\n")
            continue

        return pasta


def listar_glb(pasta):
    arquivos = [
        nome for nome in os.listdir(pasta)
        if nome.lower().endswith(".glb")
    ]
    arquivos.sort()
    return arquivos


def main():
    pasta = pedir_pasta()

    arquivos = listar_glb(pasta)

    with open("modelos.json", "w", encoding="utf-8") as f:
        json.dump(arquivos, f, indent=2, ensure_ascii=False)

    print("\n✔ Processo concluído")
    print(f"Arquivos encontrados: {len(arquivos)}")
    print("JSON salvo como: modelos.json")


if __name__ == "__main__":
    main()
