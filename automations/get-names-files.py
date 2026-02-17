import os
import json


def pedir_pasta():
    while True:
        pasta = input("Digite o CAMINHO COMPLETO da pasta:\n> ").strip().strip('"')

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


def listar_arquivos(pasta):
    arquivos = [
        nome for nome in os.listdir(pasta)
        if os.path.isfile(os.path.join(pasta, nome))
    ]
    arquivos.sort()
    return arquivos


def main():
    pasta = pedir_pasta()

    arquivos = listar_arquivos(pasta)

    with open("automations/arquivos.json", "w", encoding="utf-8") as f:
        json.dump(arquivos, f, indent=2, ensure_ascii=False)

    print("\n✔ Processo concluído")
    print(f"Arquivos encontrados: {len(arquivos)}")
    print("JSON salvo como: arquivos.json")


if __name__ == "__main__":
    main()
