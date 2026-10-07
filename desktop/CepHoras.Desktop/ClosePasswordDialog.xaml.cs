using System.Windows;

namespace CepHoras.Desktop;

public partial class ClosePasswordDialog : Window
{
    private bool preparing;
    public ClosePasswordDialog()
    {
        InitializeComponent();
        Loaded += (_, _) => PasswordInput.Focus();
        Closed += (_, _) => PasswordInput.Clear();
        Closing += (_, e) => e.Cancel = preparing;
    }

    internal void ShowPreparation()
    {
        preparing = true;
        PasswordInput.Visibility = Visibility.Collapsed;
        Actions.Visibility = Visibility.Collapsed;
        Instructions.Text = "Senha aceita. Verificando ações de energia e preparando o fechamento pelo serviço Windows…";
        Show();
    }

    internal void CompletePreparation()
    {
        if (!preparing) return;
        preparing = false;
        Close();
    }

    private void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (DailyClosePassword.IsValid(PasswordInput.Password, DateTime.Now))
        {
            PasswordInput.Clear();
            DialogResult = true;
            return;
        }

        PasswordInput.Clear();
        Feedback.Text = $"Senha diária não aceita. Confira a senha de hoje com a TI, incluindo maiúsculas e espaços. O Windows está usando a data {DateTime.Now:dd/MM/yyyy}; confira o relógio do computador.";
        PasswordInput.Focus();
    }
}
