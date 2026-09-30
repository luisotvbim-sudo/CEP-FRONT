using System.Windows;

namespace CepHoras.Desktop;

public partial class ShutdownPasswordWindow : Window
{
    private readonly ShutdownTestPolicy policy;
    internal ShutdownPasswordWindow(ShutdownTestPolicy policy)
    {
        this.policy = policy;
        InitializeComponent();
        Loaded += (_, _) => Password.Focus();
        Closed += (_, _) => Password.Clear();
    }

    private void Authorize_Click(object sender, RoutedEventArgs e)
    {
        var accepted = policy.Authorize(Password.Password);
        Password.Clear();
        if (accepted) DialogResult = true;
        else
        {
            Error.Text = "Senha incorreta. O desligamento continua bloqueado neste teste.";
            Password.Focus();
        }
    }
}
