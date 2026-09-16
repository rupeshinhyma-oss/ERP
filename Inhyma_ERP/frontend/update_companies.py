with open(r"c:\Users\Inhyma Solutions\OneDrive\Desktop\ERP\Inhyma_ERP\frontend\src\pages\Companies.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Replace the modal block
target_start = """      {modalOpen ? (
        <main className="page" style={{ width: "100%", padding: "20px 24px" }}>"""

target_end = """        </main>
      ) : ("""

replacement = """      {modalOpen ? (
        <AddNewCompanyForm
          initialCompanyId={currentCompanyId}
          onBack={closeModal}
          onSaved={(_company) => {
            closeModal();
            void reload();
          }}
        />
      ) : ("""

start_idx = content.find(target_start)
if start_idx == -1:
    print("ERROR: target_start not found!")
    exit(1)

end_idx = content.find(target_end, start_idx)
if end_idx == -1:
    print("ERROR: target_end not found!")
    exit(1)

end_idx += len(target_end)

new_content = content[:start_idx] + replacement + content[end_idx:]

# Also update CompaniesPage declaration and defaultAdd handling
decl_old = "export function CompaniesPage() {"
decl_new = """export function CompaniesPage({ defaultAdd }: { defaultAdd?: boolean } = {}) {"""

if decl_old in new_content:
    new_content = new_content.replace(decl_old, decl_new, 1)
    print("Updated export function CompaniesPage signature.")

# Add auto-open on defaultAdd
hook_old = """  const [modalOpen, setModalOpen] = useState(false);"""
hook_new = """  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (defaultAdd || urlParams.get("action") === "add" || urlParams.get("add") === "true") {
      openModal(null, "full");
    }
  }, [defaultAdd]);"""

if hook_old in new_content:
    new_content = new_content.replace(hook_old, hook_new, 1)
    print("Added defaultAdd hook.")

with open(r"c:\Users\Inhyma Solutions\OneDrive\Desktop\ERP\Inhyma_ERP\frontend\src\pages\Companies.tsx", "w", encoding="utf-8") as f:
    f.write(new_content)

print("Successfully updated Companies.tsx!")
